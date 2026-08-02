/**
 * Append generated standup markdown to a user story file.
 */
import type { OpenPlanrConfig } from '../models/types.js';
export declare function injectStandupSection(raw: string, standupMarkdown: string, date: string): string;
export declare function appendStandupToStory(projectDir: string, config: OpenPlanrConfig, storyId: string, standupMarkdown: string): Promise<void>;
//# sourceMappingURL=story-standup-service.d.ts.map