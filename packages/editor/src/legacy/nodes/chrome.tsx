// The block-chrome vocabulary moved to the shared design system so the owned
// editor and the (retiring, docs/010 §9.1) legacy decorator nodes use one
// standardized option system (docs/018 §2.8). This file is a thin re-export
// shim kept only so legacy importers keep resolving until legacy/** is deleted.
export {
  BlockChrome,
  ChromeBadge,
  ChromeBar,
  ChromeButton,
  ChromeSelect,
  CHROME_REVEAL,
  type ChromeIntent,
  type ChromeSelectOption,
} from "@quanghuy1242/idco-ui";
