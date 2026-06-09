import type { AnchorHTMLAttributes, ReactNode } from "react";
import { navigateMock } from "./next-navigation";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
  readonly children: ReactNode;
};

function shouldRouteInLadle(href: string): boolean {
  return href.startsWith("/");
}

export default function Link({ href, children, onClick, target, ...props }: LinkProps) {
  return (
    <a
      href={href}
      target={target}
      onClickCapture={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
        if (target && target !== "_self") return;
        if (!shouldRouteInLadle(href)) return;
        event.preventDefault();
        navigateMock(href);
      }}
      onClick={onClick}
      {...props}
    >
      {children}
    </a>
  );
}
