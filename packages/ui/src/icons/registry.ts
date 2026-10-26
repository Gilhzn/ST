/**
 * Curated Phosphor icon registry (Design Language v2 §8).
 *
 * Only the icons listed here are bundled: each entry deep-imports one icon module
 * (`phosphor-react-native/src/icons/<Name>`) instead of the package root, which would pull in
 * all ~1,500 icons. Modules load lazily on first render (Metro keeps `require` calls in place).
 *
 * `require` is used deliberately: a static `import` of the deep path makes TypeScript type-check
 * phosphor's .tsx sources (which do not compile under our strict settings). Types come from the
 * package root's .d.ts via `import type`, which is erased at build time.
 *
 * To add an icon: add a line below (alphabetical), keep the name = Phosphor component name.
 * `test/icons.test.ts` verifies every entry resolves to a real Phosphor export.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import type { Icon as PhosphorIcon } from "phosphor-react-native";

type Loader = () => PhosphorIcon;

function pick(mod: unknown, name: string): PhosphorIcon {
  const m = mod as Record<string, PhosphorIcon | undefined>;
  const c = m[`${name}Icon`] ?? m[name];
  if (!c) throw new Error(`@st/ui Icon: phosphor export "${name}" not found`);
  return c;
}

export const iconRegistry = {
  AppleLogo: () => pick(require("phosphor-react-native/src/icons/AppleLogo"), "AppleLogo"),
  ArrowClockwise: () => pick(require("phosphor-react-native/src/icons/ArrowClockwise"), "ArrowClockwise"),
  ArrowLeft: () => pick(require("phosphor-react-native/src/icons/ArrowLeft"), "ArrowLeft"),
  ArrowRight: () => pick(require("phosphor-react-native/src/icons/ArrowRight"), "ArrowRight"),
  ArrowSquareOut: () => pick(require("phosphor-react-native/src/icons/ArrowSquareOut"), "ArrowSquareOut"),
  ArrowsLeftRight: () => pick(require("phosphor-react-native/src/icons/ArrowsLeftRight"), "ArrowsLeftRight"),
  Basketball: () => pick(require("phosphor-react-native/src/icons/Basketball"), "Basketball"),
  Bell: () => pick(require("phosphor-react-native/src/icons/Bell"), "Bell"),
  BellSlash: () => pick(require("phosphor-react-native/src/icons/BellSlash"), "BellSlash"),
  Broadcast: () => pick(require("phosphor-react-native/src/icons/Broadcast"), "Broadcast"),
  Cake: () => pick(require("phosphor-react-native/src/icons/Cake"), "Cake"),
  CalendarBlank: () => pick(require("phosphor-react-native/src/icons/CalendarBlank"), "CalendarBlank"),
  CalendarCheck: () => pick(require("phosphor-react-native/src/icons/CalendarCheck"), "CalendarCheck"),
  CalendarDots: () => pick(require("phosphor-react-native/src/icons/CalendarDots"), "CalendarDots"),
  CalendarStar: () => pick(require("phosphor-react-native/src/icons/CalendarStar"), "CalendarStar"),
  CalendarX: () => pick(require("phosphor-react-native/src/icons/CalendarX"), "CalendarX"),
  Camera: () => pick(require("phosphor-react-native/src/icons/Camera"), "Camera"),
  CaretDown: () => pick(require("phosphor-react-native/src/icons/CaretDown"), "CaretDown"),
  CaretLeft: () => pick(require("phosphor-react-native/src/icons/CaretLeft"), "CaretLeft"),
  CaretRight: () => pick(require("phosphor-react-native/src/icons/CaretRight"), "CaretRight"),
  CaretUp: () => pick(require("phosphor-react-native/src/icons/CaretUp"), "CaretUp"),
  ChartLineUp: () => pick(require("phosphor-react-native/src/icons/ChartLineUp"), "ChartLineUp"),
  ChatCircleText: () => pick(require("phosphor-react-native/src/icons/ChatCircleText"), "ChatCircleText"),
  ChatSlash: () => pick(require("phosphor-react-native/src/icons/ChatSlash"), "ChatSlash"),
  ChatsCircle: () => pick(require("phosphor-react-native/src/icons/ChatsCircle"), "ChatsCircle"),
  Check: () => pick(require("phosphor-react-native/src/icons/Check"), "Check"),
  CheckCircle: () => pick(require("phosphor-react-native/src/icons/CheckCircle"), "CheckCircle"),
  Circle: () => pick(require("phosphor-react-native/src/icons/Circle"), "Circle"),
  Clock: () => pick(require("phosphor-react-native/src/icons/Clock"), "Clock"),
  ClockCountdown: () => pick(require("phosphor-react-native/src/icons/ClockCountdown"), "ClockCountdown"),
  Coins: () => pick(require("phosphor-react-native/src/icons/Coins"), "Coins"),
  Confetti: () => pick(require("phosphor-react-native/src/icons/Confetti"), "Confetti"),
  Copy: () => pick(require("phosphor-react-native/src/icons/Copy"), "Copy"),
  DotsThree: () => pick(require("phosphor-react-native/src/icons/DotsThree"), "DotsThree"),
  DownloadSimple: () => pick(require("phosphor-react-native/src/icons/DownloadSimple"), "DownloadSimple"),
  EnvelopeSimple: () => pick(require("phosphor-react-native/src/icons/EnvelopeSimple"), "EnvelopeSimple"),
  FileText: () => pick(require("phosphor-react-native/src/icons/FileText"), "FileText"),
  Fire: () => pick(require("phosphor-react-native/src/icons/Fire"), "Fire"),
  Flag: () => pick(require("phosphor-react-native/src/icons/Flag"), "Flag"),
  Funnel: () => pick(require("phosphor-react-native/src/icons/Funnel"), "Funnel"),
  GearSix: () => pick(require("phosphor-react-native/src/icons/GearSix"), "GearSix"),
  GenderFemale: () => pick(require("phosphor-react-native/src/icons/GenderFemale"), "GenderFemale"),
  GlobeHemisphereWest: () => pick(require("phosphor-react-native/src/icons/GlobeHemisphereWest"), "GlobeHemisphereWest"),
  GoogleLogo: () => pick(require("phosphor-react-native/src/icons/GoogleLogo"), "GoogleLogo"),
  GpsFix: () => pick(require("phosphor-react-native/src/icons/GpsFix"), "GpsFix"),
  HandWaving: () => pick(require("phosphor-react-native/src/icons/HandWaving"), "HandWaving"),
  Handshake: () => pick(require("phosphor-react-native/src/icons/Handshake"), "Handshake"),
  Hourglass: () => pick(require("phosphor-react-native/src/icons/Hourglass"), "Hourglass"),
  House: () => pick(require("phosphor-react-native/src/icons/House"), "House"),
  Info: () => pick(require("phosphor-react-native/src/icons/Info"), "Info"),
  Lightning: () => pick(require("phosphor-react-native/src/icons/Lightning"), "Lightning"),
  LinkSimple: () => pick(require("phosphor-react-native/src/icons/LinkSimple"), "LinkSimple"),
  ListBullets: () => pick(require("phosphor-react-native/src/icons/ListBullets"), "ListBullets"),
  LockSimple: () => pick(require("phosphor-react-native/src/icons/LockSimple"), "LockSimple"),
  MagnifyingGlass: () => pick(require("phosphor-react-native/src/icons/MagnifyingGlass"), "MagnifyingGlass"),
  MapPin: () => pick(require("phosphor-react-native/src/icons/MapPin"), "MapPin"),
  MapPinPlus: () => pick(require("phosphor-react-native/src/icons/MapPinPlus"), "MapPinPlus"),
  MapTrifold: () => pick(require("phosphor-react-native/src/icons/MapTrifold"), "MapTrifold"),
  Medal: () => pick(require("phosphor-react-native/src/icons/Medal"), "Medal"),
  Megaphone: () => pick(require("phosphor-react-native/src/icons/Megaphone"), "Megaphone"),
  Minus: () => pick(require("phosphor-react-native/src/icons/Minus"), "Minus"),
  Moon: () => pick(require("phosphor-react-native/src/icons/Moon"), "Moon"),
  NavigationArrow: () => pick(require("phosphor-react-native/src/icons/NavigationArrow"), "NavigationArrow"),
  PaperPlaneRight: () => pick(require("phosphor-react-native/src/icons/PaperPlaneRight"), "PaperPlaneRight"),
  PencilSimple: () => pick(require("phosphor-react-native/src/icons/PencilSimple"), "PencilSimple"),
  PersonSimpleRun: () => pick(require("phosphor-react-native/src/icons/PersonSimpleRun"), "PersonSimpleRun"),
  Phone: () => pick(require("phosphor-react-native/src/icons/Phone"), "Phone"),
  Plus: () => pick(require("phosphor-react-native/src/icons/Plus"), "Plus"),
  Prohibit: () => pick(require("phosphor-react-native/src/icons/Prohibit"), "Prohibit"),
  QrCode: () => pick(require("phosphor-react-native/src/icons/QrCode"), "QrCode"),
  Question: () => pick(require("phosphor-react-native/src/icons/Question"), "Question"),
  Racquet: () => pick(require("phosphor-react-native/src/icons/Racquet"), "Racquet"),
  Scan: () => pick(require("phosphor-react-native/src/icons/Scan"), "Scan"),
  SealCheck: () => pick(require("phosphor-react-native/src/icons/SealCheck"), "SealCheck"),
  Share: () => pick(require("phosphor-react-native/src/icons/Share"), "Share"),
  ShareNetwork: () => pick(require("phosphor-react-native/src/icons/ShareNetwork"), "ShareNetwork"),
  ShieldCheck: () => pick(require("phosphor-react-native/src/icons/ShieldCheck"), "ShieldCheck"),
  ShieldWarning: () => pick(require("phosphor-react-native/src/icons/ShieldWarning"), "ShieldWarning"),
  Shuffle: () => pick(require("phosphor-react-native/src/icons/Shuffle"), "Shuffle"),
  SignOut: () => pick(require("phosphor-react-native/src/icons/SignOut"), "SignOut"),
  SlidersHorizontal: () => pick(require("phosphor-react-native/src/icons/SlidersHorizontal"), "SlidersHorizontal"),
  Sneaker: () => pick(require("phosphor-react-native/src/icons/Sneaker"), "Sneaker"),
  SoccerBall: () => pick(require("phosphor-react-native/src/icons/SoccerBall"), "SoccerBall"),
  Sparkle: () => pick(require("phosphor-react-native/src/icons/Sparkle"), "Sparkle"),
  Star: () => pick(require("phosphor-react-native/src/icons/Star"), "Star"),
  Strategy: () => pick(require("phosphor-react-native/src/icons/Strategy"), "Strategy"),
  Sun: () => pick(require("phosphor-react-native/src/icons/Sun"), "Sun"),
  TennisBall: () => pick(require("phosphor-react-native/src/icons/TennisBall"), "TennisBall"),
  Timer: () => pick(require("phosphor-react-native/src/icons/Timer"), "Timer"),
  Translate: () => pick(require("phosphor-react-native/src/icons/Translate"), "Translate"),
  Trash: () => pick(require("phosphor-react-native/src/icons/Trash"), "Trash"),
  Trophy: () => pick(require("phosphor-react-native/src/icons/Trophy"), "Trophy"),
  User: () => pick(require("phosphor-react-native/src/icons/User"), "User"),
  UserCircle: () => pick(require("phosphor-react-native/src/icons/UserCircle"), "UserCircle"),
  UserMinus: () => pick(require("phosphor-react-native/src/icons/UserMinus"), "UserMinus"),
  UserPlus: () => pick(require("phosphor-react-native/src/icons/UserPlus"), "UserPlus"),
  Users: () => pick(require("phosphor-react-native/src/icons/Users"), "Users"),
  UsersThree: () => pick(require("phosphor-react-native/src/icons/UsersThree"), "UsersThree"),
  Volleyball: () => pick(require("phosphor-react-native/src/icons/Volleyball"), "Volleyball"),
  Warning: () => pick(require("phosphor-react-native/src/icons/Warning"), "Warning"),
  WarningCircle: () => pick(require("phosphor-react-native/src/icons/WarningCircle"), "WarningCircle"),
  WhatsappLogo: () => pick(require("phosphor-react-native/src/icons/WhatsappLogo"), "WhatsappLogo"),
  X: () => pick(require("phosphor-react-native/src/icons/X"), "X"),
  XCircle: () => pick(require("phosphor-react-native/src/icons/XCircle"), "XCircle"),
} satisfies Record<string, Loader>;

/** Every icon name the app may use (Phosphor component names). */
export type IconName = keyof typeof iconRegistry;

export const iconNames = Object.keys(iconRegistry) as IconName[];

const cache = new Map<IconName, PhosphorIcon>();

/** Resolves (and memoizes) the Phosphor component for a registry name. */
export function resolveIcon(name: IconName): PhosphorIcon {
  let c = cache.get(name);
  if (!c) {
    c = iconRegistry[name]();
    cache.set(name, c);
  }
  return c;
}

/**
 * Icons that point in the reading direction and mirror in RTL (docs §9.2).
 * Everything else (sports, objects, check marks, clocks, logos, QR) never mirrors.
 */
export const directionalIcons: ReadonlySet<IconName> = new Set<IconName>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowSquareOut",
  "CaretLeft",
  "CaretRight",
  "PaperPlaneRight",
  "SignOut",
  "ListBullets",
  "ChatCircleText",
  "Share",
]);

export function isDirectionalIcon(name: IconName): boolean {
  return directionalIcons.has(name);
}
