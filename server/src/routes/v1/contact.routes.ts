import type { FastifyInstance } from 'fastify';
import { Validator } from '../../lib/validation.ts';
import { createContact } from '../../repositories/contacts.repo.ts';
import { rateLimitConfig } from '../../lib/http.ts';

export default async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { config: rateLimitConfig(5, '10 minutes') }, async (request, reply) => {
    const v = new Validator(request.body as Record<string, unknown>);
    const name = v.string('name', { required: true, min: 2, max: 120 });
    const email = v.email('email');
    const subject = v.string('subject', { required: true, min: 3, max: 160 });
    const message = v.string('message', { required: true, min: 10, max: 4000 });
    v.assert();

    const contact = await createContact({
      name: name!, email: email!, subject: subject!, message: message!,
    });
    return reply.status(201).send({
      id: contact.id,
      message: 'Thanks — your message has been received. We usually reply within two working days.',
    });
  });
}
