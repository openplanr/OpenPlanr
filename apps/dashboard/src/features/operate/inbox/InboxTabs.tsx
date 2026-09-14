import { RadixTabs as Tabs } from '../../../design-system/components/index.js';
import { InboxItemDetail } from './InboxItemDetail.js';
import type { InboxCategory, OperateInboxItem, OperateInboxModel } from './inbox-model.js';
import { INBOX_CATEGORIES } from './inbox-model.js';

const CATEGORY_LABEL = Object.freeze({
  decision: 'Decision',
  approval: 'Approval',
  verification: 'Verification',
} satisfies Readonly<Record<InboxCategory, string>>);

export type InboxTabsProps = Readonly<{
  model: OperateInboxModel;
  mutationEnabled?: boolean;
  selected: InboxCategory;
  pendingItemId: string | null;
  onSelectedChange: (category: InboxCategory) => void;
  onPreview: (item: OperateInboxItem, triggerId: string) => void | Promise<void>;
}>;

function isInboxCategory(value: string): value is InboxCategory {
  return INBOX_CATEGORIES.some((category) => category === value);
}

export function InboxTabs({
  model,
  mutationEnabled = model.mutationEnabled,
  selected,
  pendingItemId,
  onSelectedChange,
  onPreview,
}: InboxTabsProps) {
  return (
    <Tabs.Root
      className="op-inbox-tabs"
      value={selected}
      activationMode="automatic"
      orientation="horizontal"
      onValueChange={(value) => {
        if (isInboxCategory(value)) onSelectedChange(value);
      }}
    >
      <Tabs.List className="op-inbox-tabs__list" aria-label="Inbox categories">
        {INBOX_CATEGORIES.map((category) => {
          const count = model.categories[category].length;
          const noun = count === 1 ? 'item' : 'items';
          return (
            <Tabs.Trigger
              className="op-inbox-tabs__trigger"
              value={category}
              key={category}
              aria-label={`${CATEGORY_LABEL[category]}, ${count} ${noun}`}
            >
              <span>{CATEGORY_LABEL[category]}</span>
              <strong aria-hidden="true">{count}</strong>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      {INBOX_CATEGORIES.map((category) => {
        const items = model.categories[category];
        return (
          <Tabs.Content
            className="op-inbox-tabs__panel"
            value={category}
            key={category}
            forceMount
            tabIndex={0}
            aria-label={`${CATEGORY_LABEL[category]} queue, ${items.length} ${
              items.length === 1 ? 'item' : 'items'
            }`}
          >
            {items.length > 0 ? (
              <ol className="op-inbox-queue" aria-label={`${CATEGORY_LABEL[category]} items`}>
                {items.map((item) => (
                  <li key={item.itemId}>
                    <InboxItemDetail
                      item={item}
                      mutationEnabled={mutationEnabled}
                      pendingItemId={pendingItemId}
                      surfaceReasonCodes={model.surface.reasonCodes}
                      headingLevel={2}
                      onPreview={onPreview}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <section className="op-inbox-empty" role="status">
                <p className="op-eyebrow">Nothing to review</p>
                <h2>No {CATEGORY_LABEL[category].toLocaleLowerCase('en-US')} items</h2>
                <p>This category is clear right now.</p>
              </section>
            )}
          </Tabs.Content>
        );
      })}
    </Tabs.Root>
  );
}
