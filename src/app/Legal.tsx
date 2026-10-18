import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Public Privacy and Terms pages. Brand-fixed colours like the Landing page, so
// they read the same for everyone, signed in or not. Keep every statement true
// to what the code does — Google's verification reviewers read this.

const UPDATED = '17 October 2026';
const OWNER = 'Ashish Patil';
// The contact address is put together in the browser, so it never appears in
// the page HTML or as one string in the code — simple scrapers can't harvest it.
const SCRAMBLED = ['reppoc', 'moc.litapnitinhsihsa'];

function useContactEmail(): string {
  const [email, setEmail] = useState('');
  useEffect(() => {
    const [user, domain] = SCRAMBLED.map((p) => [...p].reverse().join(''));
    setEmail(`${user}@${domain}`);
  }, []);
  return email;
}

function ContactEmail() {
  const email = useContactEmail();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <span>the contact link below</span>;
}

/** Sets the browser tab title (and what search results show) for a page. */
function usePageTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}
const SITE = 'copper.ashishnitinpatil.com';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const email = useContactEmail();
  usePageTitle(`${title} · Copper`);
  return (
    <main className="min-h-full bg-[#FBF7F2] px-5 py-12 text-[#33241A] sm:py-16">
      <article className="mx-auto max-w-2xl">
        <Link to="/" className="inline-flex items-center gap-2 font-display text-lg font-semibold text-[#33241A]">
          <img src="/icon.svg" alt="" aria-hidden className="h-6 w-6" />
          Copper
        </Link>
        <h1 className="mt-10 font-display text-4xl font-semibold leading-tight">{title}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.2em] text-[#9A7B5F]">Last updated {UPDATED}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-[#4A3728] [&_a]:font-medium [&_a]:text-[#9E5429] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[#33241A] [&_li]:mt-1.5 [&_p+p]:mt-3 [&_ul+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
        <footer className="mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#E7D6C3] pt-6 text-sm text-[#7A6551]">
          <Link to="/" className="hover:text-[#33241A]">Home</Link>
          <Link to="/privacy" className="hover:text-[#33241A]">Privacy</Link>
          <Link to="/terms" className="hover:text-[#33241A]">Terms</Link>
          {email && (
            <a href={`mailto:${email}`} className="hover:text-[#33241A]">
              Contact
            </a>
          )}
        </footer>
      </article>
    </main>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy">
      <section>
        <p className="text-lg text-[#33241A]">
          Copper has no server of its own. What you enter stays in your browser and, if you turn on
          sync, in your own Google Drive. We can&rsquo;t see your book, and we don&rsquo;t want to.
        </p>
      </section>

      <section>
        <h2>What stays on your device</h2>
        <p>
          Your accounts, transactions, categories, budgets, settings and change history are stored in
          your browser&rsquo;s local storage on the device you use. Nothing is sent to us. Copper has no
          analytics, no advertising and no tracking cookies.
        </p>
      </section>

      <section>
        <h2>If you sign in with Google</h2>
        <p>Signing in is optional. If you do, Copper asks Google for:</p>
        <ul>
          <li>
            <strong>Your name, email address and profile picture</strong> — to show who is signed in, and
            to label the changes you make in the Activity history with your first name.
          </li>
          <li>
            <strong>Access to the Drive files Copper creates or that you choose</strong> (the{' '}
            <code>drive.file</code> permission) — to save your book and its backups in a{' '}
            &ldquo;Copper Expense Tracker&rdquo; folder in your Drive and keep your devices in sync.
            Copper can&rsquo;t see any other files in your Drive.
          </li>
        </ul>
        <p>
          These requests go straight from your browser to Google. Your sign-in is remembered on your
          device only — for this browser session, or until you sign out if you choose &ldquo;Trust this
          device&rdquo;.
        </p>
        <p>
          Copper&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. That information is used only to provide Copper&rsquo;s
          features to you. It is never sold, used for advertising, or shared with anyone.
        </p>
      </section>

      <section>
        <h2>Sharing a book</h2>
        <p>
          If you share your book with someone through Google Drive, they can see everything in it —
          including your first name and device names next to the changes you made. Sharing is always
          something you start, and you can stop it in Google Drive.
        </p>
      </section>

      <section>
        <h2>Hosting</h2>
        <p>
          The Copper app itself is served by Cloudflare. Like any web host, Cloudflare may briefly
          process technical details such as your IP address to deliver the site and protect it from
          abuse. Google&rsquo;s sign-in screens are covered by{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google&rsquo;s privacy policy
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Deleting your data</h2>
        <ul>
          <li>On a device: Settings › Your data › Erase this device.</li>
          <li>In Google Drive: delete the &ldquo;Copper Expense Tracker&rdquo; folder.</li>
          <li>
            To remove Copper&rsquo;s access to your Google account, visit{' '}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              your Google account&rsquo;s third-party access page
            </a>
            .
          </li>
        </ul>
      </section>

      <section>
        <h2>Children</h2>
        <p>Copper isn&rsquo;t directed at children under 13.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          If this policy changes, the new version will appear here with a new date. Questions? Email{' '}
          <ContactEmail />.
        </p>
      </section>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms">
      <section>
        <p className="text-lg text-[#33241A]">
          Copper is free to use. These terms are short on purpose.
        </p>
      </section>

      <section>
        <h2>Using Copper</h2>
        <p>
          You can use Copper at {SITE} for free, for personal or any other lawful purpose. Your data is
          yours: it lives on your devices and in your own Google Drive, and you can export or delete it
          at any time.
        </p>
        <p>
          You&rsquo;re responsible for your own book — keeping backups, and deciding who you share it
          with. Copper is a record-keeping tool, not financial, tax or legal advice.
        </p>
      </section>

      <section>
        <h2>The software licence</h2>
        <p>
          Copper&rsquo;s software is released under the MIT License. You may use, copy, change, share and
          even sell it, as long as you keep the copyright notice and licence text below with every copy
          or substantial part you pass on.
        </p>
        <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-[#E7D6C3] bg-white/60 p-4 font-mono text-xs leading-relaxed text-[#4A3728]">
          {/* Reflow each paragraph so it wraps cleanly on narrow screens. */}
          {MIT_LICENSE.replace(/(?<!\n)\n(?!\n)/g, ' ')}
        </pre>
      </section>

      <section>
        <h2>No warranty</h2>
        <p>
          Copper is provided &ldquo;as is&rdquo;, without warranty of any kind, as the licence above
          says. To the extent the law allows, {OWNER} isn&rsquo;t liable for lost data, wrong figures or
          any other loss from using it. The hosted app may change, pause or stop at any time — your data
          stays with you either way.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions? Email <ContactEmail />. See also the{' '}
          <Link to="/privacy">privacy policy</Link>.
        </p>
      </section>
    </LegalPage>
  );
}

export const MIT_LICENSE = `MIT License

Copyright (c) 2026 ${OWNER}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
