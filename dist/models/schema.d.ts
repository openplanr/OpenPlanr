import { z } from 'zod';
export declare const targetCLISchema: z.ZodEnum<{
    cursor: "cursor";
    claude: "claude";
    codex: "codex";
}>;
export declare const aiProviderSchema: z.ZodEnum<{
    anthropic: "anthropic";
    openai: "openai";
    ollama: "ollama";
}>;
export declare const codingAgentSchema: z.ZodEnum<{
    cursor: "cursor";
    claude: "claude";
    codex: "codex";
}>;
export declare const aiConfigSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        anthropic: "anthropic";
        openai: "openai";
        ollama: "ollama";
    }>;
    model: z.ZodOptional<z.ZodString>;
    ollamaBaseUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const vaguePhraseRuleSchema: z.ZodObject<{
    pattern: z.ZodString;
    alternatives: z.ZodArray<z.ZodString>;
    hint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const reportLinterRuleConfigSchema: z.ZodObject<{
    id: z.ZodString;
    enabled: z.ZodBoolean;
    minEvidenceLinks: z.ZodOptional<z.ZodNumber>;
    requireSections: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const reportLinterConfigSchema: z.ZodObject<{
    rules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        enabled: z.ZodBoolean;
        minEvidenceLinks: z.ZodOptional<z.ZodNumber>;
        requireSections: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    vaguePhrases: z.ZodArray<z.ZodObject<{
        pattern: z.ZodString;
        alternatives: z.ZodArray<z.ZodString>;
        hint: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const stakeholderReportsConfigSchema: z.ZodObject<{
    orgName: z.ZodOptional<z.ZodString>;
    logoUrl: z.ZodOptional<z.ZodString>;
    accentColor: z.ZodOptional<z.ZodString>;
    customSections: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export declare const distributionConfigSchema: z.ZodObject<{
    slackWebhookUrl: z.ZodOptional<z.ZodString>;
    slackChannel: z.ZodOptional<z.ZodString>;
    emailFrom: z.ZodOptional<z.ZodString>;
    emailSmtpHost: z.ZodOptional<z.ZodString>;
    weeklyRecipientAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/** Persisted Linear configuration. `teamId` remains the default and preserves legacy configs. */
export declare const linearConfigSchema: z.ZodObject<{
    teamId: z.ZodString;
    teamKey: z.ZodOptional<z.ZodString>;
    teams: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        key: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>>;
    defaultProjectLead: z.ZodOptional<z.ZodString>;
    statusMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    pushStateIds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    standaloneProjectId: z.ZodOptional<z.ZodString>;
    standaloneProjectName: z.ZodOptional<z.ZodString>;
    defaultEpicStrategy: z.ZodOptional<z.ZodEnum<{
        project: "project";
        "milestone-of": "milestone-of";
        "label-on": "label-on";
    }>>;
    typeLabels: z.ZodOptional<z.ZodObject<{
        feature: z.ZodOptional<z.ZodString>;
        story: z.ZodOptional<z.ZodString>;
        task: z.ZodOptional<z.ZodString>;
        quick: z.ZodOptional<z.ZodString>;
        backlog: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const configSchema: z.ZodObject<{
    projectName: z.ZodString;
    targets: z.ZodArray<z.ZodEnum<{
        cursor: "cursor";
        claude: "claude";
        codex: "codex";
    }>>;
    outputPaths: z.ZodObject<{
        agile: z.ZodDefault<z.ZodString>;
        cursorRules: z.ZodDefault<z.ZodString>;
        claudeConfig: z.ZodDefault<z.ZodString>;
        codexConfig: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    idPrefix: z.ZodObject<{
        epic: z.ZodDefault<z.ZodString>;
        feature: z.ZodDefault<z.ZodString>;
        story: z.ZodDefault<z.ZodString>;
        task: z.ZodDefault<z.ZodString>;
        quick: z.ZodDefault<z.ZodString>;
        backlog: z.ZodDefault<z.ZodString>;
        sprint: z.ZodDefault<z.ZodString>;
        spec: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    ai: z.ZodOptional<z.ZodObject<{
        provider: z.ZodEnum<{
            anthropic: "anthropic";
            openai: "openai";
            ollama: "ollama";
        }>;
        model: z.ZodOptional<z.ZodString>;
        ollamaBaseUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    defaultAgent: z.ZodOptional<z.ZodEnum<{
        cursor: "cursor";
        claude: "claude";
        codex: "codex";
    }>>;
    templateOverrides: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    reports: z.ZodOptional<z.ZodObject<{
        orgName: z.ZodOptional<z.ZodString>;
        logoUrl: z.ZodOptional<z.ZodString>;
        accentColor: z.ZodOptional<z.ZodString>;
        customSections: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
    distribution: z.ZodOptional<z.ZodObject<{
        slackWebhookUrl: z.ZodOptional<z.ZodString>;
        slackChannel: z.ZodOptional<z.ZodString>;
        emailFrom: z.ZodOptional<z.ZodString>;
        emailSmtpHost: z.ZodOptional<z.ZodString>;
        weeklyRecipientAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    reportLinter: z.ZodOptional<z.ZodObject<{
        rules: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            enabled: z.ZodBoolean;
            minEvidenceLinks: z.ZodOptional<z.ZodNumber>;
            requireSections: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        vaguePhrases: z.ZodArray<z.ZodObject<{
            pattern: z.ZodString;
            alternatives: z.ZodArray<z.ZodString>;
            hint: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    linear: z.ZodOptional<z.ZodObject<{
        teamId: z.ZodString;
        teamKey: z.ZodOptional<z.ZodString>;
        teams: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            key: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>>>;
        defaultProjectLead: z.ZodOptional<z.ZodString>;
        statusMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        pushStateIds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        standaloneProjectId: z.ZodOptional<z.ZodString>;
        standaloneProjectName: z.ZodOptional<z.ZodString>;
        defaultEpicStrategy: z.ZodOptional<z.ZodEnum<{
            project: "project";
            "milestone-of": "milestone-of";
            "label-on": "label-on";
        }>>;
        typeLabels: z.ZodOptional<z.ZodObject<{
            feature: z.ZodOptional<z.ZodString>;
            story: z.ZodOptional<z.ZodString>;
            task: z.ZodOptional<z.ZodString>;
            quick: z.ZodOptional<z.ZodString>;
            backlog: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ValidatedConfig = z.infer<typeof configSchema>;
//# sourceMappingURL=schema.d.ts.map