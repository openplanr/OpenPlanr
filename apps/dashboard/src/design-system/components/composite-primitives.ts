import {
  AlertDialog as RadixAlertDialog,
  Dialog as RadixDialog,
  Tabs as RadixTabs,
} from 'radix-ui';
import './governed-controls.css';

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

export const Dialog = Object.freeze({
  Root: RadixDialog.Root,
  Trigger: RadixDialog.Trigger,
  Portal: RadixDialog.Portal,
  Overlay: RadixDialog.Overlay,
  Content: RadixDialog.Content,
  Title: RadixDialog.Title,
  Close: RadixDialog.Close,
});

export const Tabs = Object.freeze({
  Root: RadixTabs.Root,
  List: RadixTabs.List,
  Trigger: RadixTabs.Trigger,
  Content: RadixTabs.Content,
});
