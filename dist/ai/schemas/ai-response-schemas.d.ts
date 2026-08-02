/**
 * Zod schemas for validating AI JSON responses.
 *
 * These ensure the AI returned all required fields in the correct
 * format before we pass data to artifact creation.
 */
import { z } from 'zod';
export declare const aiEpicResponseSchema: z.ZodObject<{
    title: z.ZodString;
    owner: z.ZodString;
    businessValue: z.ZodString;
    targetUsers: z.ZodString;
    problemStatement: z.ZodString;
    solutionOverview: z.ZodString;
    successCriteria: z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>]>;
    keyFeatures: z.ZodArray<z.ZodString>;
    dependencies: z.ZodDefault<z.ZodString>;
    risks: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AIEpicResponse = z.infer<typeof aiEpicResponseSchema>;
export declare const aiFeatureSchema: z.ZodObject<{
    title: z.ZodString;
    overview: z.ZodString;
    functionalRequirements: z.ZodArray<z.ZodString>;
    dependencies: z.ZodDefault<z.ZodString>;
    technicalConsiderations: z.ZodDefault<z.ZodString>;
    risks: z.ZodDefault<z.ZodString>;
    successMetrics: z.ZodString;
}, z.core.$strip>;
export declare const aiFeaturesResponseSchema: z.ZodObject<{
    features: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        overview: z.ZodString;
        functionalRequirements: z.ZodArray<z.ZodString>;
        dependencies: z.ZodDefault<z.ZodString>;
        technicalConsiderations: z.ZodDefault<z.ZodString>;
        risks: z.ZodDefault<z.ZodString>;
        successMetrics: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AIFeaturesResponse = z.infer<typeof aiFeaturesResponseSchema>;
export declare const aiGherkinScenarioSchema: z.ZodObject<{
    name: z.ZodString;
    given: z.ZodString;
    when: z.ZodString;
    then: z.ZodString;
}, z.core.$strip>;
export declare const aiStorySchema: z.ZodObject<{
    title: z.ZodString;
    role: z.ZodString;
    goal: z.ZodString;
    benefit: z.ZodString;
    additionalNotes: z.ZodDefault<z.ZodString>;
    gherkinScenarios: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        given: z.ZodString;
        when: z.ZodString;
        then: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const aiStoriesResponseSchema: z.ZodObject<{
    stories: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        role: z.ZodString;
        goal: z.ZodString;
        benefit: z.ZodString;
        additionalNotes: z.ZodDefault<z.ZodString>;
        gherkinScenarios: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            given: z.ZodString;
            when: z.ZodString;
            then: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AIStoriesResponse = z.infer<typeof aiStoriesResponseSchema>;
export declare const aiSubtaskSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
}, z.core.$strip>;
export declare const aiTaskGroupSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    subtasks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const aiACMappingSchema: z.ZodObject<{
    criterion: z.ZodString;
    sourceStoryId: z.ZodString;
    taskIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const aiRelevantFileSchema: z.ZodObject<{
    path: z.ZodString;
    reason: z.ZodString;
    action: z.ZodDefault<z.ZodEnum<{
        modify: "modify";
        create: "create";
    }>>;
}, z.core.$strip>;
export declare const aiTasksResponseSchema: z.ZodObject<{
    title: z.ZodString;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        subtasks: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    acceptanceCriteriaMapping: z.ZodDefault<z.ZodArray<z.ZodObject<{
        criterion: z.ZodString;
        sourceStoryId: z.ZodString;
        taskIds: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>>;
    relevantFiles: z.ZodDefault<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        reason: z.ZodString;
        action: z.ZodDefault<z.ZodEnum<{
            modify: "modify";
            create: "create";
        }>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type AITasksResponse = z.infer<typeof aiTasksResponseSchema>;
export declare const aiQuickTasksResponseSchema: z.ZodObject<{
    title: z.ZodString;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        subtasks: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    relevantFiles: z.ZodDefault<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        reason: z.ZodString;
        action: z.ZodDefault<z.ZodEnum<{
            modify: "modify";
            create: "create";
        }>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type AIQuickTasksResponse = z.infer<typeof aiQuickTasksResponseSchema>;
export declare const aiEstimateResponseSchema: z.ZodObject<{
    storyPoints: z.ZodNumber;
    estimatedHours: z.ZodNumber;
    complexity: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    riskFactors: z.ZodArray<z.ZodString>;
    reasoning: z.ZodString;
    assumptions: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type AIEstimateResponse = z.infer<typeof aiEstimateResponseSchema>;
export declare const aiBacklogPrioritizedItemSchema: z.ZodObject<{
    id: z.ZodString;
    priority: z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    impactScore: z.ZodNumber;
    effortScore: z.ZodNumber;
    reasoning: z.ZodString;
}, z.core.$strip>;
export declare const aiBacklogPrioritizeResponseSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        priority: z.ZodEnum<{
            critical: "critical";
            high: "high";
            medium: "medium";
            low: "low";
        }>;
        impactScore: z.ZodNumber;
        effortScore: z.ZodNumber;
        reasoning: z.ZodString;
    }, z.core.$strip>>;
    summary: z.ZodString;
}, z.core.$strip>;
export type AIBacklogPrioritizeResponse = z.infer<typeof aiBacklogPrioritizeResponseSchema>;
export declare const aiSprintAutoSelectResponseSchema: z.ZodObject<{
    selectedTaskIds: z.ZodArray<z.ZodString>;
    totalPoints: z.ZodNumber;
    reasoning: z.ZodString;
}, z.core.$strip>;
export type AISprintAutoSelectResponse = z.infer<typeof aiSprintAutoSelectResponseSchema>;
export declare const aiRefineResponseSchema: z.ZodObject<{
    suggestions: z.ZodArray<z.ZodString>;
    improved: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    frontmatterChanges: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    bodyChanges: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"replaceSection">;
        heading: z.ZodString;
        newContent: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"replaceText">;
        findExact: z.ZodString;
        replaceWith: z.ZodString;
    }, z.core.$strip>], "type">>>;
    improvedMarkdown: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AIRefineResponse = z.infer<typeof aiRefineResponseSchema>;
export declare const aiReviseActionSchema: z.ZodEnum<{
    revise: "revise";
    skip: "skip";
    flag: "flag";
}>;
export declare const aiReviseEvidenceTypeSchema: z.ZodEnum<{
    file_exists: "file_exists";
    file_absent: "file_absent";
    grep_match: "grep_match";
    sibling_artifact: "sibling_artifact";
    source_quote: "source_quote";
    pattern_rule: "pattern_rule";
}>;
export declare const aiReviseEvidenceSchema: z.ZodObject<{
    type: z.ZodEnum<{
        file_exists: "file_exists";
        file_absent: "file_absent";
        grep_match: "grep_match";
        sibling_artifact: "sibling_artifact";
        source_quote: "source_quote";
        pattern_rule: "pattern_rule";
    }>;
    ref: z.ZodString;
    quote: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const aiReviseAmbiguitySchema: z.ZodObject<{
    section: z.ZodString;
    reason: z.ZodString;
}, z.core.$strip>;
/**
 * Schema for a single revise agent decision.
 *
 * Action-specific invariants (enforced via `superRefine`):
 * - `revise` → non-empty `revisedMarkdown` AND at least one `evidence` entry
 * - `flag`   → at least one `ambiguous` entry (evidence encouraged but not required)
 * - `skip`   → no `revisedMarkdown`, no `ambiguous` entries
 *
 * The TS shape in `ReviseDecision` (src/models/types.ts) is the consumer-facing
 * view; this schema is what the AI response is validated against before it
 * reaches the post-flight verifier.
 */
export declare const aiReviseDecisionSchema: z.ZodObject<{
    artifactId: z.ZodString;
    action: z.ZodEnum<{
        revise: "revise";
        skip: "skip";
        flag: "flag";
    }>;
    revisedMarkdown: z.ZodOptional<z.ZodString>;
    rationale: z.ZodString;
    evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<{
            file_exists: "file_exists";
            file_absent: "file_absent";
            grep_match: "grep_match";
            sibling_artifact: "sibling_artifact";
            source_quote: "source_quote";
            pattern_rule: "pattern_rule";
        }>;
        ref: z.ZodString;
        quote: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    ambiguous: z.ZodDefault<z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type AIReviseDecisionResponse = z.infer<typeof aiReviseDecisionSchema>;
export declare const aiSpecTaskSchema: z.ZodObject<{
    title: z.ZodString;
    type: z.ZodEnum<{
        UI: "UI";
        Tech: "Tech";
    }>;
    agent: z.ZodString;
    filesCreate: z.ZodDefault<z.ZodArray<z.ZodString>>;
    filesModify: z.ZodDefault<z.ZodArray<z.ZodString>>;
    filesPreserve: z.ZodDefault<z.ZodArray<z.ZodString>>;
    objective: z.ZodString;
    technicalSpec: z.ZodDefault<z.ZodString>;
    testRequirements: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AISpecTask = z.infer<typeof aiSpecTaskSchema>;
export declare const aiSpecStorySchema: z.ZodObject<{
    title: z.ZodString;
    roleAction: z.ZodString;
    benefit: z.ZodString;
    scope: z.ZodDefault<z.ZodString>;
    acceptanceCriteria: z.ZodArray<z.ZodString>;
    tasks: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        type: z.ZodEnum<{
            UI: "UI";
            Tech: "Tech";
        }>;
        agent: z.ZodString;
        filesCreate: z.ZodDefault<z.ZodArray<z.ZodString>>;
        filesModify: z.ZodDefault<z.ZodArray<z.ZodString>>;
        filesPreserve: z.ZodDefault<z.ZodArray<z.ZodString>>;
        objective: z.ZodString;
        technicalSpec: z.ZodDefault<z.ZodString>;
        testRequirements: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AISpecStory = z.infer<typeof aiSpecStorySchema>;
export declare const aiSpecDecomposeResponseSchema: z.ZodObject<{
    stories: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        roleAction: z.ZodString;
        benefit: z.ZodString;
        scope: z.ZodDefault<z.ZodString>;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        tasks: z.ZodArray<z.ZodObject<{
            title: z.ZodString;
            type: z.ZodEnum<{
                UI: "UI";
                Tech: "Tech";
            }>;
            agent: z.ZodString;
            filesCreate: z.ZodDefault<z.ZodArray<z.ZodString>>;
            filesModify: z.ZodDefault<z.ZodArray<z.ZodString>>;
            filesPreserve: z.ZodDefault<z.ZodArray<z.ZodString>>;
            objective: z.ZodString;
            technicalSpec: z.ZodDefault<z.ZodString>;
            testRequirements: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    decompositionNotes: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AISpecDecomposeResponse = z.infer<typeof aiSpecDecomposeResponseSchema>;
//# sourceMappingURL=ai-response-schemas.d.ts.map