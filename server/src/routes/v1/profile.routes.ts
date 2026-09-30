import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware.ts';
import { Validator } from '../../lib/validation.ts';
import { badRequest, conflict, notFound } from '../../lib/errors.ts';
import { recordAudit } from '../../repositories/audit.repo.ts';
import { findDepartment } from '../../repositories/departments.repo.ts';
import {
  findUserById, studentIdTaken, toPublicUser, updateOwnProfile,
} from '../../repositories/users.repo.ts';

const PHONE_RE = /^[+0-9 ()\-]{6,24}$/;
const STUDENT_ID_RE = /^[A-Za-z0-9\-/]{3,32}$/;

/**
 * The signed-in user's own account.
 *
 * There is deliberately no `/profile/:id`. The user is always taken from the
 * authenticated session, so there is no identifier a client could substitute to
 * read or edit somebody else's account.
 */
export default async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Builds the response from the database, so a PATCH echoes what was stored. */
  const currentProfile = async (userId: string) => {
    const user = await findUserById(userId);
    if (!user) throw notFound('Account');

    const department = user.department_id ? await findDepartment(user.department_id) : null;
    const profile = toPublicUser(user);

    // How much of the editable account information has been filled in.
    const fields = [profile.firstName, profile.lastName, profile.phone, profile.studentId];
    const completion = Math.round((fields.filter(Boolean).length / fields.length) * 100);

    return {
      profile: { ...profile, departmentName: department?.name ?? null },
      completion,
    };
  };

  app.get('/', async (request) => currentProfile(request.currentUser!.id));

  app.patch('/', async (request) => {
    const body = request.body as Record<string, unknown>;
    const userId = request.currentUser!.id;

    const v = new Validator(body);
    const firstName = v.string('firstName', { min: 1, max: 80 });
    const lastName = v.string('lastName', { min: 1, max: 80 });
    const phone = v.string('phone', { max: 24 });
    const studentId = v.string('studentId', { max: 32 });
    v.assert();

    // These mirror the CHECK constraints, so a bad value is a readable 400
    // rather than a database error surfacing as a generic 500.
    if (phone && !PHONE_RE.test(phone)) {
      throw badRequest('Telefon nömrəsi yalnız rəqəm, boşluq və + ( ) - simvollarından ibarət ola bilər', {
        fields: { phone: 'Düzgün telefon nömrəsi daxil edin' }, field: 'phone',
      });
    }
    if (studentId && !STUDENT_ID_RE.test(studentId)) {
      throw badRequest('Tələbə nömrəsi yalnız hərf, rəqəm, - və / simvollarından ibarət ola bilər', {
        fields: { studentId: 'Yalnız hərf, rəqəm, - və / simvolları (3–32)' },
        field: 'studentId',
      });
    }
    if (studentId && (await studentIdTaken(studentId, userId))) {
      throw conflict('Bu tələbə nömrəsi başqa hesaba qeydiyyatdadır', {
        fields: { studentId: 'Başqa hesaba qeydiyyatdadır' }, field: 'studentId',
      });
    }

    const updated = await updateOwnProfile(userId, {
      ...('firstName' in body ? { firstName } : {}),
      ...('lastName' in body ? { lastName } : {}),
      // An empty string clears an optional field.
      ...('phone' in body ? { phone: phone ?? null } : {}),
      ...('studentId' in body ? { studentId: studentId ?? null } : {}),
    });
    if (!updated) throw notFound('Account');

    await recordAudit({
      userId, action: 'PROFILE_UPDATED', resource: 'user', resourceId: userId,
      metadata: { fields: Object.keys(body) }, ipAddress: request.ip,
    });

    return currentProfile(userId);
  });
}
