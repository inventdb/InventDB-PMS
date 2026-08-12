import {
  Building2,
  LayoutGrid,
  Users,
  FileText,
  Wrench,
  HardHat,
  Wallet,
  CreditCard,
  ClipboardList,
  Folder,
  FolderTree,
  Inbox,
  ClipboardCheck,
  UserRound,
  Megaphone,
  LayoutDashboard,
  BarChart3,
  Sparkles,
  Settings,
  Shield,
  ListChecks,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// Maps the string icon keys used in entity/nav config to Lucide components.
const ICONS: { [key: string]: LucideIcon } = {
  building: Building2,
  "layout-grid": LayoutGrid,
  users: Users,
  "file-text": FileText,
  wrench: Wrench,
  "hard-hat": HardHat,
  wallet: Wallet,
  "credit-card": CreditCard,
  "clipboard-list": ClipboardList,
  folder: Folder,
  inbox: Inbox,
  "clipboard-check": ClipboardCheck,
  "user-round": UserRound,
  megaphone: Megaphone,
  shield: Shield,
  "list-checks": ListChecks,
  workflow: Workflow,
  files: FolderTree,
  dashboard: LayoutDashboard,
  reports: BarChart3,
  analyze: Sparkles,
  settings: Settings,
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
}) {
  const Cmp = ICONS[name] ?? FileText;
  return <Cmp size={size} strokeWidth={strokeWidth} />;
}
