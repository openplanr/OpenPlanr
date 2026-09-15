import { CycleDetailRoute } from '../../../operate/cycles/CycleDetailRoute.js';
import {
  CyclesPage,
  createOperateCyclesDisplayValidator,
} from '../../../operate/cycles/CyclesPage.js';

export const cycleRoutes = Object.freeze({
  DetailRoute: CycleDetailRoute,
  ListPage: CyclesPage,
  createListValidator: createOperateCyclesDisplayValidator,
});
