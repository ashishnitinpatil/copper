import { Link, Navigate } from 'react-router-dom';
import {
  ShieldCheck,
  CloudUpload,
  Coins,
  LineChart,
  ArrowLeftRight,
  Lock,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppSettings } from './AppSettingsProvider';

// Copper's public front door. Brand-fixed colours (not theme tokens) so the page
// reads the same for everyone — like the logo, it's a brand surface. Returning
// users never see it: they're bounced to their dashboard below.

interface Feature {
  icon: LucideIcon;
  title: string;
  desc: string;
  tag: string;
}

// Only things Copper genuinely does today — no aspirational claims.
const FEATURES: Feature[] = [
  {
    icon: ShieldCheck,
    title: 'Local-first & private',
    desc: 'Your ledger lives in your browser. Nothing is sent to a server we run — because there isn’t one.',
    tag: 'on-device',
  },
  {
    icon: CloudUpload,
    title: 'Sync through your own Drive',
    desc: 'Turn on sync and Copper keeps a copy in your personal Google Drive, shared across your devices.',
    tag: 'your Drive',
  },
  {
    icon: Coins,
    title: 'Multi-currency',
    desc: 'Hold accounts in different currencies and see a clear per-currency total, not a muddled one.',
    tag: 'any currency',
  },
  {
    icon: LineChart,
    title: 'Budgets & cashflow',
    desc: 'Set monthly budgets and look ahead — a forecast of where your balance is heading this month.',
    tag: 'plan ahead',
  },
  {
    icon: ArrowLeftRight,
    title: 'Bring your history',
    desc: 'Moving from Monefy? Import a CSV export and your accounts, categories and entries come along.',
    tag: 'import',
  },
  {
    icon: Lock,
    title: 'Backups you own',
    desc: 'Export everything to a single file whenever you like — optionally locked with a password.',
    tag: 'portable',
  },
];

// The setup, in the order you'd actually do it — numbering earns its place here.
const SHARE_STEPS: { title: string; desc: string }[] = [
  {
    title: 'Sign in as yourself',
    desc: 'Each person uses their own Google account — no shared login to hand around.',
  },
  {
    title: 'Share the folder',
    desc: 'One of you shares the ledger’s Drive folder with the other, straight from Drive.',
  },
  {
    title: 'Connect, and go',
    desc: 'The other taps “Connect a shared folder” once. From then on, changes merge both ways.',
  },
];

function CopperButton({
  to,
  variant,
  children,
}: {
  to: string;
  variant: 'solid' | 'ghost';
  children: React.ReactNode;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D58A4F]';
  const styles =
    variant === 'solid'
      ? 'bg-[#B4682F] text-[#FDF6EE] shadow-lg shadow-[#B4682F]/30 hover:bg-[#9E5429] hover:-translate-y-0.5'
      : 'border border-[#E7C9A8]/40 text-[#F6EDE3] hover:border-[#E7C9A8]/70 hover:bg-white/5';
  return (
    <Link to={to} className={`${base} ${styles}`}>
      {children}
    </Link>
  );
}

export function Landing() {
  const { onboarded } = useAppSettings();
  if (onboarded) return <Navigate to="/dashboard" replace />;

  return (
    <main className="min-h-full bg-[#FBF7F2] text-[#33241A]">
      {/* ── Hero ── warm-ink, matching the installed app tile + social card ── */}
      <section className="relative overflow-hidden bg-[radial-gradient(120%_130%_at_20%_15%,#2c1d13_0%,#1c1410_55%,#140d09_100%)] px-6 py-20 text-center sm:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(213,138,79,0.30),rgba(213,138,79,0)_62%)] blur-md"
        />
        <div className="page-enter relative mx-auto flex max-w-2xl flex-col items-center">
          <img
            src="/icon.svg"
            alt="The Copper mark: a copper coin overlapping an open ring"
            className="h-24 w-24 drop-shadow-[0_14px_30px_rgba(0,0,0,0.55)]"
          />
          <p className="mt-8 font-mono text-xs uppercase tracking-[0.32em] text-[#D58A4F]">
            Personal finance · Local-first
          </p>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.05] text-[#F6EDE3] sm:text-6xl">
            Money that stays yours.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#C9B19A]">
            Copper is a tracker for everyday spending that lives on your device and
            your own Google Drive — no servers, no sign-up, no one looking over your
            shoulder.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <CopperButton to="/welcome" variant="solid">
              Get started <ArrowRight size={16} />
            </CopperButton>
            <CopperButton to="/welcome?restore" variant="ghost">
              I have a backup
            </CopperButton>
          </div>
          <p className="mt-6 font-mono text-xs tracking-wide text-[#9A8674]">
            Free · Installable · Works offline
          </p>
        </div>
      </section>

      {/* ── Features ── a ledger of what Copper actually does ── */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#B4682F]">
            Only what’s yours
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-[#2A1B12] sm:text-4xl">
            Enough to hold your whole picture — and nothing that phones home.
          </h2>
        </div>

        <ul className="mt-12 grid gap-x-12 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="flex gap-4 border-t border-[#EBDFD1] py-6 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#B4682F]/10 text-[#B4682F]">
                <f.icon size={20} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-lg font-semibold text-[#2A1B12]">
                    {f.title}
                  </h3>
                  <span className="rounded-full bg-[#B4682F]/8 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#9E5429]">
                    {f.tag}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[#6B5A49]">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Shared ledger ── the other half of the premise: two people, one book ── */}
      <section className="relative overflow-hidden bg-[radial-gradient(120%_130%_at_80%_15%,#2c1d13_0%,#1c1410_55%,#140d09_100%)] px-6 py-20 sm:py-28">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          {/* Two discs meeting in a bright overlap — the same idea as the mark,
              here standing for two people keeping one ledger. */}
          <div className="relative flex items-center justify-center" aria-hidden>
            <span className="block h-16 w-16 rounded-full bg-[radial-gradient(circle_at_35%_30%,#E7A05C,#9E5429)] shadow-[0_10px_30px_rgba(0,0,0,0.5)]" />
            <span className="-ml-6 block h-16 w-16 rounded-full bg-[radial-gradient(circle_at_65%_30%,#F3D8B8,#B4682F)] mix-blend-screen" />
          </div>
          <p className="mt-8 font-mono text-xs uppercase tracking-[0.32em] text-[#D58A4F]">
            Made for two
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold leading-[1.08] text-[#F6EDE3] sm:text-5xl">
            One ledger, kept by two.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#C9B19A]">
            Copper began as a way to track money together. You and your partner each sign
            in with your own Google account and connect the same Drive folder — then every
            entry, from either phone, shows up for both. No shared password, no server in
            between, and it still works offline.
          </p>
          <ol className="mt-11 grid gap-4 text-left sm:grid-cols-3">
            {SHARE_STEPS.map((s, i) => (
              <li
                key={s.title}
                className="rounded-2xl border border-[#E7C9A8]/15 bg-white/[0.03] p-5"
              >
                <span className="font-mono text-xs tracking-widest text-[#D58A4F]">
                  0{i + 1}
                </span>
                <h3 className="mt-2 font-display text-base font-semibold text-[#F6EDE3]">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#B49A82]">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Origin story ── the honest meaning of the mark (built with AI) ── */}
      <section className="border-y border-[#EBDFD1] bg-[#F4ECE1] px-6 py-20 sm:py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <img
            src="/icon.svg"
            alt=""
            aria-hidden
            className="h-16 w-16 drop-shadow-[0_8px_18px_rgba(168,95,44,0.25)]"
          />
          <h2 className="mt-7 font-display text-3xl font-semibold text-[#2A1B12]">
            Made by two, together.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#5C4B3B]">
            Copper was designed and built by one person and an AI, side by side. The
            mark says it plainly: the solid copper coin is you, the open ring is the
            AI, and the bright sliver where they meet is everything made in the
            overlap.
          </p>
          <p className="mt-4 text-base leading-relaxed text-[#5C4B3B]">
            That partnership is in how Copper was <em>built</em> — not in who sees
            your money. No AI, and no one else, ever reads your ledger.
          </p>
        </div>
      </section>

      {/* ── Closing CTA ── bookends the hero ── */}
      <section className="bg-[radial-gradient(120%_130%_at_80%_20%,#2c1d13_0%,#1c1410_60%,#140d09_100%)] px-6 py-20 text-center sm:py-24">
        <h2 className="font-display text-4xl font-semibold text-[#F6EDE3]">
          Ready when you are.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[#C9B19A]">
          Takes a minute to set up, and there’s nothing to sign up for.
        </p>
        <div className="mt-8 flex justify-center">
          <CopperButton to="/welcome" variant="solid">
            Get started <ArrowRight size={16} />
          </CopperButton>
        </div>
        <footer className="mt-16 flex items-center justify-center gap-2 font-mono text-xs tracking-wide text-[#7A6551]">
          <img src="/icon.svg" alt="" aria-hidden className="h-4 w-4 opacity-80" />
          Copper — a local-first personal-finance app
        </footer>
      </section>
    </main>
  );
}
