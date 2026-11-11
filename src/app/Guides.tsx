import { Link } from 'react-router-dom';
import { LegalPage } from './Legal';

// Public guides for what people search for when they're looking for something
// like Copper. Same rule as Privacy and Terms: every sentence true to the code.

const UPDATED = '12 November 2026';

export function ForCouples() {
  return (
    <LegalPage title="A shared expense tracker for couples" updated={UPDATED}>
      <p>
        Copper started as a way for two people to keep one record of their household money: every coffee, grocery run
        and bill, entered from whichever phone was handy, and seen by both. It’s free, there’s nothing to sign up for,
        and the book lives in your own Google Drive, not on a company’s server.
      </p>

      <section>
        <h2>How sharing works</h2>
        <ul>
          <li>Each of you signs in with your own Google account. There’s no shared password to pass around.</li>
          <li>
            One of you shares the book with the other’s Google account from Copper’s settings and sends them the link.
          </li>
          <li>The other opens the link, signs in and picks the book once. From then on you both write to the same book.</li>
        </ul>
        <p>
          An entry goes up to your shared book a few seconds after it’s made, and the other phone picks it up when
          Copper is opened, or within a few minutes if it’s already open. Offline, it keeps working and catches up when
          the connection is back.
          If you both change the same entry, the change made last is the one kept; everything else from both of you is
          merged.
        </p>
      </section>

      <section>
        <h2>Knowing who did what</h2>
        <p>
          The Activity page lists every change and who made it: what was added, edited or deleted, and when. A deleted
          entry can be brought back from there. It answers “did you already add the electricity bill?” without
          asking.
        </p>
      </section>

      <section>
        <h2>What you can keep together</h2>
        <ul>
          <li>Accounts for cash, bank accounts, cards and loans, each in its own currency.</li>
          <li>Categories and tags you both use, with monthly budgets for the ones you want to watch.</li>
          <li>Reports by month, quarter or year, and a cashflow forecast of where your balances are heading.</li>
          <li>
            Many entries at once: paste a bank statement or a spreadsheet, and Copper points out the rows that are
            already in, so you can find what neither of you added.
          </li>
        </ul>
      </section>

      <section>
        <h2>Worth knowing first</h2>
        <ul>
          <li>Everything in a shared book is visible to both of you. Copper has no private accounts inside a book.</li>
          <li>
            Copper keeps track of money; it doesn’t split bills or work out who owes whom. It suits couples who share
            their spending, rather than housemates settling up.
          </li>
          <li>The book is a file in the Google Drive of whoever created it, shared with the other like any Drive file.</li>
        </ul>
      </section>

      <p>
        <Link to="/welcome">Start your book</Link> · <Link to="/privacy">How your data is handled</Link>
      </p>
    </LegalPage>
  );
}

export function FromMonefy() {
  return (
    <LegalPage title="Moving from Monefy" updated={UPDATED}>
      <p>
        Copper reads Monefy’s CSV export, so your history comes with you: accounts, categories, every entry and the
        transfers between your accounts. It takes a few minutes, and you can check everything before anything is
        saved.
      </p>

      <section>
        <h2>1. Export from Monefy</h2>
        <p>
          In Monefy, use the export option in its settings to save your records as a CSV file, and get that file onto
          the device you’ll use Copper on (email it to yourself, or save it to Google Drive).
        </p>
      </section>

      <section>
        <h2>2. Import into Copper</h2>
        <ul>
          <li>
            <Link to="/welcome">Set up Copper</Link> first if you haven’t, then open Settings › Your data › Import
            Monefy CSV and choose the file.
          </li>
          <li>
            Copper shows what it found before importing. You can rename accounts, say which are cards, bank accounts or
            loans, pick your main account, and choose whether to add to what’s already in Copper or replace it.
          </li>
          <li>Transfers between accounts come across as transfers, not as spending and income.</li>
          <li>
            If you sync through Google Drive, Copper keeps a copy of your book from just before the import, so you can
            go back if something looks wrong.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Catch up on anything since</h2>
        <p>
          If you’ve kept going in Monefy for a while, or have entries only on a bank statement, use Add › Add several.
          Paste rows from a spreadsheet or statement and Copper flags the ones that are already in, so you add only what’s
          missing.
        </p>
      </section>

      <section>
        <h2>What’s different in Copper</h2>
        <ul>
          <li>Your data stays on your device and in your own Google Drive. There’s no Copper account or server.</li>
          <li>Two people can keep one book, each from their own phone. See <Link to="/for-couples">Copper for couples</Link>.</li>
          <li>It’s an installable web app: the same book on a phone and a computer, and it works offline.</li>
        </ul>
      </section>
    </LegalPage>
  );
}
