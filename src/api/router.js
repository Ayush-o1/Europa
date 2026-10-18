/**
 * @fileoverview Main API v1 Router
 *
 * Mounts modular sub-routers for health, ingestion, conjunction events, and audit ledger.
 */

import { Router } from 'express';
import { healthRouter } from './routes/healthRoutes.js';
import { ingestionRouter } from './routes/ingestionRoutes.js';
import { eventRouter } from './routes/eventRoutes.js';
import { auditRouter } from './routes/auditRoutes.js';

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use(ingestionRouter);
v1Router.use(eventRouter);
v1Router.use(auditRouter);
