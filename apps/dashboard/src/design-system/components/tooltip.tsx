import { Tooltip as Primitive } from 'radix-ui';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

export type TooltipProps = Readonly<{ children: ReactElement; content: ReactNode }>;

export function Tooltip({ children, content }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);
  const clear = () => clearTimeout(timer.current);
  const hide = () => {
    clear();
    setOpen(false);
  };
  const leave = () => {
    clear();
    timer.current = setTimeout(() => {
      if (!hovered.current && !focused.current) setOpen(false);
    }, 100);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Primitive.Provider delayDuration={400} skipDelayDuration={0} disableHoverableContent>
      <Primitive.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : leave())}>
        <Primitive.Trigger
          asChild
          onPointerEnter={() => {
            hovered.current = true;
            clear();
          }}
          onPointerLeave={() => {
            hovered.current = false;
            leave();
          }}
          onFocus={() => {
            focused.current = true;
            clear();
            setOpen(true);
          }}
          onBlur={() => {
            focused.current = false;
            hide();
          }}
          onPointerDown={hide}
          onClick={hide}
        >
          {children}
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            className="pc-tooltip"
            sideOffset={8}
            onEscapeKeyDown={hide}
            onPointerEnter={() => {
              hovered.current = true;
              clear();
            }}
            onPointerLeave={() => {
              hovered.current = false;
              leave();
            }}
          >
            {content}
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
