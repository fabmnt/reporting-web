import { createContext, useContext, type AnchorHTMLAttributes, type MouseEvent } from "react";

type NavigationValue = {
  path: string;
  navigate: (path: string) => void;
};

const NavigationContext = createContext<NavigationValue | null>(null);

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (value === null) {
    throw new Error("useNavigation must be used inside AppShell.");
  }
  return value;
}

export { NavigationContext };

// Only a plain left click becomes client-side navigation. Modified clicks and
// middle clicks keep the browser default, so open-in-new-tab still works.
function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function AppLink({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useNavigation();

  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
