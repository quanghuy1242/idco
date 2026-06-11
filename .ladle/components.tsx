import { useLayoutEffect } from "react";
import { ThemeState, type GlobalProvider } from "@ladle/react";
import previewStylesHref from "./preview.css?url";

function getThemeName(theme: ThemeState): "idco-light" | "idco-dark" {
  return theme === ThemeState.Dark ? "idco-dark" : "idco-light";
}

export const Provider: GlobalProvider = ({ globalState, children }) => {
  const themeName = getThemeName(globalState.theme);

  useLayoutEffect(() => {
    document.body.setAttribute("data-theme", themeName);
  }, [themeName]);

  return (
    <>
      <link rel="stylesheet" href={previewStylesHref} />
      <div data-theme={themeName}>{children}</div>
    </>
  );
};
