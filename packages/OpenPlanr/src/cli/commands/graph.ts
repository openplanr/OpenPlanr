import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { readProjectGraph } from '../../services/graph-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerGraphCommand(program: Command) {
  program
    .command('graph')
    .description('Emit the OpenPlanr artifact graph')
    .option('--json', 'output the graph as JSON')
    .action(async (opts: { json?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const graph = readProjectGraph(projectDir, config);

      if (opts.json) {
        display.line(JSON.stringify(graph, null, 2));
        return;
      }

      const counts = graph.nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {});

      logger.heading(`Project Graph - ${config.projectName}`);
      display.blank();
      for (const [type, count] of Object.entries(counts).sort()) {
        display.line(`  ${chalk.bold(type)}: ${count}`);
      }
      display.blank();
      logger.dim(`Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length}`);
      logger.dim('Use --json for the protocol graph payload.');
    });
}
