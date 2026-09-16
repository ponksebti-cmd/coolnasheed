import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import { Icon, type IconName } from "./Icons";

export type MenuItem = {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  hint?: string;
};

export function DropdownMenu({
  items,
  label = "More",
  size = 18,
  align = "right",
  buttonClass,
  renderTrigger,
}: {
  items: MenuItem[];
  label?: string;
  size?: number;
  align?: "left" | "right";
  buttonClass?: string;
  renderTrigger?: (props: { onClick: () => void; open: boolean }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    setFlip(rect.bottom > window.innerHeight - 12 || rect.top < 12);
  }, [open]);

  return (
    <div ref={root} className="relative">
      {renderTrigger ? (
        renderTrigger({ onClick: () => setOpen((v) => !v), open })
      ) : (
        <button
          className={clsx(
            "btn-icon grid place-items-center rounded-full p-2",
            buttonClass,
          )}
          onClick={() => setOpen((v) => !v)}
          aria-label={label}
          aria-expanded={open}
        >
          <Icon name="more" size={size} />
        </button>
      )}
      {open ? (
        <div
          ref={panel}
          className={clsx(
            "glass pop-in absolute z-[80] min-w-[210px] overflow-hidden rounded-xl p-1.5",
            align === "right" ? "right-0" : "left-0",
            flip ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
          role="menu"
        >
          {items.map((item, i) => {
            const Comp = item.href ? "a" : "button";
            return (
              <Comp
                key={i}
                role="menuitem"
                href={item.href}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick?.();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                  item.disabled
                    ? "cursor-not-allowed text-muted/50"
                    : item.danger
                      ? "text-madder hover:bg-madder/12"
                      : "text-text2 hover:bg-surface3 hover:text-text",
                )}
              >
                {item.icon ? (
                  <Icon
                    name={item.icon}
                    size={15}
                    className="shrink-0 opacity-80"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.checked ? (
                  <Icon name="check" size={14} className="text-jade" />
                ) : null}
                {item.hint ? (
                  <span className="text-[10px] text-muted">{item.hint}</span>
                ) : null}
              </Comp>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
