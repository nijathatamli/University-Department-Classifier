import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { env } from './config/env.ts';
import { attachUser } from './auth/middleware.ts';
import { errorHandler, notFoundHandler } from './lib/http.ts';
import { pool } from './db/pool.ts';
import { classifierHealthy } from './lib/classifier-client.ts';

import authRoutes from './routes/v1/auth.routes.ts';
import departmentRoutes from './routes/v1/departments.routes.ts';
import departmentQueueRoutes from './routes/v1/department.routes.ts';
import requestRoutes from './routes/v1/requests.routes.ts';
import profileRoutes from './routes/v1/profile.routes.ts';
import modelRoutes from './routes/v1/model.routes.ts';
import contactRoutes from './routes/v1/contact.routes.ts';
import adminRoutes from './routes/v1/admin.routes.ts';

const WEB_ROOT = resolve(import.meta.dirname, '../../web');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isTest
      ? false
      : {
          level: env.isProduction ? 'info' : 'debug',
          // Never let credentials or session tokens reach the logs.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
          ],
        },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  app.setErrorHandler(errorHandler);

  // --- security ------------------------------------------------------------
  await app.register(helmet, {
    // The landing page inlines its styles/script and loads Three.js from a CDN,
    // so the CSP is scoped to exactly those sources rather than disabled.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://unpkg.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: env.corsOrigin.length ? env.corsOrigin : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    global: true,
    max: env.rateLimitMax,
    timeWindow: env.rateLimitWindow,
    // Tests would otherwise trip the limiter while exercising auth endpoints.
    enableDraftSpec: true,
    ...(env.isTest ? { max: 100_000 } : {}),
  });

  await app.register(cookie, { secret: env.jwtSecret });

  // Resolve the session on every request; individual routes decide what to do.
  app.addHook('preHandler', attachUser);

  // --- API documentation ---------------------------------------------------
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'University Department Classifier API',
        description:
          'Versioned REST API for automatic routing of student requests. A student ' +
          'submits a written message, a TF-IDF + Logistic Regression model classifies it, ' +
          'and the resulting ticket is assigned to the responsible department. ' +
          'Authentication uses an httpOnly session cookie set by /api/v1/auth/login; ' +
          'a Bearer token is also accepted.',
        version: '1.0.0',
      },
      servers: [{ url: env.apiUrl }],
      tags: [
        { name: 'auth', description: 'Registration, login, password reset' },
        { name: 'requests', description: 'Submitting, reading and tracking student requests' },
        { name: 'profile', description: 'The signed-in user\'s own account' },
        { name: 'departments', description: 'Routing targets' },
        { name: 'department', description: 'Department-side ticket queue' },
        { name: 'model', description: 'Model version and evaluation metrics' },
        { name: 'contact', description: 'Contact messages' },
        { name: 'admin', description: 'Administration and statistics' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'udc_session' },
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // --- API routes ----------------------------------------------------------
  await app.register(
    async (api) => {
      api.get('/health', async () => {
        await pool.query('SELECT 1');
        return {
          status: 'ok',
          version: '1.0.0',
          // Reported separately: the API can be healthy while the Python
          // inference service is down, and the UI needs to distinguish them.
          classifier: (await classifierHealthy()) ? 'up' : 'down',
        };
      });

      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(requestRoutes, { prefix: '/requests' });
      await api.register(profileRoutes, { prefix: '/profile' });
      await api.register(departmentRoutes, { prefix: '/departments' });
      await api.register(departmentQueueRoutes, { prefix: '/department' });
      await api.register(modelRoutes, { prefix: '/model' });
      await api.register(contactRoutes, { prefix: '/contact' });
      await api.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api/v1' },
  );

  // --- static frontend -----------------------------------------------------
  const hasWeb = existsSync(WEB_ROOT);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: WEB_ROOT, prefix: '/', index: ['index.html'] });
  }

  // Single not-found handler: serve extensionless pretty URLs
  // (/classifier -> classifier.html), otherwise return the JSON error shape.
  app.setNotFoundHandler((request, reply) => {
    if (hasWeb && request.method === 'GET' && !request.url.startsWith('/api')) {
      const clean = request.url.split('?')[0]!.replace(/^\/+|\/+$/g, '');
      const segments = clean === '' ? [] : clean.split('/');

      // /classifier -> classifier.html
      const flat = segments.length === 0 ? 'index.html' : `${segments[0]}.html`;
      // /departments/computer-science -> departments-detail.html
      const detail = segments.length === 2 ? `${segments[0]}-detail.html` : null;

      // Constrained pattern so a crafted path can never escape the web root.
      const safe = (name: string | null): name is string =>
        !!name && /^[a-z0-9-]+\.html$/i.test(name) && existsSync(resolve(WEB_ROOT, name));

      if (segments.length <= 1 && safe(flat)) return reply.sendFile(flat);
      if (safe(detail)) return reply.sendFile(detail);
    }
    return notFoundHandler(request, reply);
  });

  return app;
}
