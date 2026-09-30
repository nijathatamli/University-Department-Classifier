import type { FastifyInstance } from 'fastify';
import { Validator } from '../../lib/validation.ts';
import { clearSessionCookie, rateLimitConfig, setSessionCookie } from '../../lib/http.ts';
import { requireAuth } from '../../auth/middleware.ts';
import * as authService from '../../services/auth.service.ts';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // Auth endpoints get a much tighter rate limit than the rest of the API.
  const strictLimit = rateLimitConfig(10, '1 minute');

  app.post('/register', { config: strictLimit }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const v = new Validator(body);
    const email = v.email('email');
    const password = v.password('password');
    const firstName = v.string('firstName', { required: true, min: 1, max: 80 });
    const lastName = v.string('lastName', { required: true, min: 1, max: 80 });
    v.assert();

    const result = await authService.register({
      email: email!, password: password!, firstName: firstName!, lastName: lastName!,
      ip: request.ip,
    });
    setSessionCookie(reply, result.token);
    return reply.status(201).send({ user: result.user });
  });

  app.post('/login', { config: strictLimit }, async (request, reply) => {
    const v = new Validator(request.body as Record<string, unknown>);
    const email = v.email('email');
    const password = v.string('password', { required: true, max: 128 });
    v.assert();

    const result = await authService.login({ email: email!, password: password!, ip: request.ip });
    setSessionCookie(reply, result.token);
    return reply.send({ user: result.user });
  });

  app.post('/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/me', { preHandler: requireAuth }, async (request) => ({
    user: await authService.me(request.currentUser!.id),
  }));

  app.post('/change-password', {
    config: strictLimit, preHandler: requireAuth,
  }, async (request, reply) => {
    const v = new Validator(request.body as Record<string, unknown>);
    const currentPassword = v.string('currentPassword', { required: true, max: 128 });
    const newPassword = v.password('newPassword');
    v.assert();

    await authService.changePassword({
      userId: request.currentUser!.id,
      currentPassword: currentPassword!,
      newPassword: newPassword!,
      ip: request.ip,
    });
    return reply.send({ message: 'Your password has been updated.' });
  });

  app.post('/forgot-password', { config: strictLimit }, async (request, reply) => {
    const v = new Validator(request.body as Record<string, unknown>);
    const email = v.email('email');
    v.assert();

    const result = await authService.requestPasswordReset(email!);
    // Identical response whether or not the account exists.
    return reply.send({
      message: 'If an account exists for that address, a reset link has been sent.',
      ...(result.devToken ? { devToken: result.devToken } : {}),
    });
  });

  app.post('/reset-password', { config: strictLimit }, async (request, reply) => {
    const v = new Validator(request.body as Record<string, unknown>);
    const token = v.string('token', { required: true, min: 10, max: 200 });
    const password = v.password('password');
    v.assert();

    await authService.resetPassword(token!, password!);
    return reply.send({ message: 'Your password has been updated. You can now sign in.' });
  });
}
