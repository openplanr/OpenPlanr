import { AlertDialog as RadixAlertDialog, Tabs as RadixTabs } from 'radix-ui';

/** Closed, reviewed composite primitives available to dashboard feature code. */
export const AlertDialog = Object.freeze({
  Root: RadixAlertDialog.Root,
  Portal: RadixAlertDialog.Portal,
  Overlay: RadixAlertDialog.Overlay,
  Content: RadixAlertDialog.Content,
  Title: RadixAlertDialog.Title,
  Description: RadixAlertDialog.Description,
  Cancel: RadixAlertDialog.Cancel,
});

export const Tabs = Object.freeze({
  Root: RadixTabs.Root,
  List: RadixTabs.List,
  Trigger: RadixTabs.Trigger,
  Content: RadixTabs.Content,
});
