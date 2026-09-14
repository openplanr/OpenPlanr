import {
  Activity,
  ArrowRight,
  Ban,
  Bookmark,
  Bot,
  Box,
  Braces,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CirclePause,
  CirclePlay,
  CircleSlash,
  CircleX,
  Clock,
  Columns3,
  Copy,
  CornerDownRight,
  Dot,
  ExternalLink,
  FileCheck,
  FileDiff,
  FileText,
  Filter,
  Flag,
  Folder,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Hash,
  History,
  Inbox,
  Info,
  Layers,
  LifeBuoy,
  List,
  ListTree,
  LoaderCircle,
  Lock,
  Minus,
  Monitor,
  Moon,
  OctagonAlert,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Shield,
  Sparkles,
  Square,
  SquareCheckBig,
  SquareDashed,
  Star,
  Sun,
  Table,
  Target,
  Terminal,
  TriangleAlert,
  Unplug,
  User,
  Workflow,
  X,
} from 'lucide-react';

/**
 * The design system's glyph registry, keyed by its kebab-case names, backed by Lucide.
 * Bundled by Vite (no CDN, no fetch) so the loopback console renders offline.
 */
const GLYPHS = Object.freeze({
  activity: Activity,
  'arrow-right': ArrowRight,
  ban: Ban,
  bookmark: Bookmark,
  bot: Bot,
  box: Box,
  braces: Braces,
  'calendar-days': CalendarDays,
  'calendar-range': CalendarRange,
  check: Check,
  'check-check': CheckCheck,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevrons-up-down': ChevronsUpDown,
  circle: Circle,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-dashed': CircleDashed,
  'circle-minus': CircleMinus,
  'circle-pause': CirclePause,
  'circle-play': CirclePlay,
  'circle-slash': CircleSlash,
  'circle-x': CircleX,
  clock: Clock,
  'columns-3': Columns3,
  copy: Copy,
  'corner-down-right': CornerDownRight,
  dot: Dot,
  'external-link': ExternalLink,
  'file-check': FileCheck,
  'file-diff': FileDiff,
  'file-text': FileText,
  filter: Filter,
  flag: Flag,
  folder: Folder,
  gauge: Gauge,
  'git-branch': GitBranch,
  'git-commit': GitCommitHorizontal,
  'git-pull-request': GitPullRequest,
  hash: Hash,
  history: History,
  inbox: Inbox,
  info: Info,
  layers: Layers,
  'life-buoy': LifeBuoy,
  list: List,
  'list-tree': ListTree,
  'loader-circle': LoaderCircle,
  lock: Lock,
  minus: Minus,
  monitor: Monitor,
  moon: Moon,
  'octagon-alert': OctagonAlert,
  'panel-left-close': PanelLeftClose,
  'panel-right-close': PanelRightClose,
  plus: Plus,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  'scroll-text': ScrollText,
  search: Search,
  shield: Shield,
  sparkles: Sparkles,
  square: Square,
  'square-check-big': SquareCheckBig,
  'square-dashed': SquareDashed,
  star: Star,
  sun: Sun,
  table: Table,
  target: Target,
  terminal: Terminal,
  'triangle-alert': TriangleAlert,
  unplug: Unplug,
  user: User,
  workflow: Workflow,
  x: X,
});

export type PcIconName = keyof typeof GLYPHS;

export type PcIconProps = Readonly<{
  name: PcIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  title?: string;
  spin?: boolean;
  pulse?: boolean;
}>;

/** Inline glyph at 1.75 stroke on a 24-box; inherits `currentColor` unless a color is given. */
export function PcIcon({
  name,
  size = 16,
  color = 'currentColor',
  strokeWidth = 1.75,
  title,
  spin = false,
  pulse = false,
}: PcIconProps) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      className="pc-icon"
      data-icon={name}
      data-spin={spin || undefined}
      data-pulse={pulse || undefined}
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    />
  );
}
