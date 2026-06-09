// DaisyUI 5 dock icon sizing: https://daisyui.com/components/dock/
// DaisyUI 5 menu: https://daisyui.com/components/menu/
import {
  Activity,
  AppWindow,
  Bell,
  Bot,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FileCheck2,
  FileText,
  Fingerprint,
  Globe,
  HeartPulse,
  History,
  Info,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  Minus,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  Activity,
  AppWindow,
  Bell,
  Bot,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FileCheck2,
  FileText,
  Fingerprint,
  Globe,
  HeartPulse,
  History,
  Info,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  Minus,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  X,
};

type NavIconVariant = "sidebar" | "dock";

const sizeMap: Record<NavIconVariant, string> = {
  sidebar: "size-4",
  dock: "size-[1.2em]",
};

export function NavIcon({
  name,
  variant = "sidebar",
}: {
  name?: string;
  variant?: NavIconVariant;
}) {
  if (!name) return null;
  const Icon = iconMap[name];
  if (!Icon) return null;
  return <Icon className={`${sizeMap[variant]} shrink-0`} aria-hidden="true" />;
}
