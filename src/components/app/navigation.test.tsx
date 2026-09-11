import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppLink, NavigationContext } from "./navigation";

// jsdom cannot perform a real navigation, and a modified or middle click
// legitimately falls through to the browser default. Cancel the default in a
// bubble listener so the run stays quiet. React handles the event on the render
// container first, so this never changes what AppLink decides to do.
function cancelBrowserNavigation(event: MouseEvent) {
  event.preventDefault();
}

beforeEach(() => document.addEventListener("click", cancelBrowserNavigation));
afterEach(() => document.removeEventListener("click", cancelBrowserNavigation));

const MODIFIERS = {
  control: { ctrlKey: true },
  meta: { metaKey: true },
  shift: { shiftKey: true },
  alt: { altKey: true },
} satisfies Record<string, MouseEventInit>;

function renderAppLink() {
  const navigate = vi.fn();
  const onClick = vi.fn();

  render(
    <NavigationContext.Provider value={{ path: "/", navigate }}>
      <AppLink href="/admin" onClick={onClick}>
        Admin
      </AppLink>
    </NavigationContext.Provider>
  );

  return { navigate, onClick, link: screen.getByRole("link", { name: "Admin" }) };
}

describe("AppLink", () => {
  it("keeps the real href so the link works without JavaScript", () => {
    const { link } = renderAppLink();
    expect(link).toHaveAttribute("href", "/admin");
  });

  it("navigates in place on a plain left click", () => {
    const { navigate, link } = renderAppLink();

    fireEvent.click(link);

    expect(navigate).toHaveBeenCalledWith("/admin");
  });

  it.each(Object.entries(MODIFIERS))(
    "leaves %s clicks to the browser so new tabs keep working",
    (_name, init) => {
      const { navigate, link } = renderAppLink();

      fireEvent.click(link, init);

      expect(navigate).not.toHaveBeenCalled();
    }
  );

  it("leaves middle clicks to the browser", () => {
    const { navigate, link } = renderAppLink();

    fireEvent.click(link, { button: 1 });

    expect(navigate).not.toHaveBeenCalled();
  });

  it("still runs the caller's onClick", () => {
    const { onClick, link } = renderAppLink();

    fireEvent.click(link);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
