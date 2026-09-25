import type { FastifyInstance } from 'fastify';
import { notFound } from '../../lib/errors.ts';
import { findDepartment, listDepartments } from '../../repositories/departments.repo.ts';

const shape = (d: { id: string; name: string; slug: string; description: string; email: string | null }) => ({
  id: d.id, name: d.name, slug: d.slug, description: d.description, email: d.email,
});

/** Public: the routing targets a request can be assigned to. */
export default async function departmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { items: (await listDepartments()).map(shape) };
  });

  app.get('/:idOrSlug', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string };
    const department = await findDepartment(idOrSlug);
    if (!department || !department.is_active) throw notFound('Department');
    return { department: shape(department) };
  });
}
