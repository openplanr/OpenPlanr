export type PlanrHomeEnvironment = Readonly<Record<string, string | undefined>>;
export declare function configuredPlanrHome(env?: PlanrHomeEnvironment): string | undefined;
export declare function planrHome(env?: PlanrHomeEnvironment): string;
export declare function userHome(env?: PlanrHomeEnvironment): string;
