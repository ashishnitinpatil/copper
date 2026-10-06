// Plain-language answer to "why sign in, and what can Copper see?" — shown
// wherever we ask for Google. Keep it true to the scopes in google.ts
// (openid email profile + drive.file) and to the fact that there's no server.
export function GoogleAccessNote() {
  return (
    <details className="group rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
      <summary className="cursor-pointer select-none font-medium text-slate-300 hover:text-slate-100">
        What does signing in with Google do?
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-4">
        <li>
          <span className="text-slate-300">Why it's needed:</span> Copper has no server. To sync, it
          keeps your book as a file in your own Google Drive, and your devices — and your partner, if
          you invite one — read and write that file.
        </li>
        <li>
          <span className="text-slate-300">What Copper can see:</span> your name and email address,
          and in Drive only the files Copper creates (your book and its backups) or that you pick for
          it, like a book your partner shared. Not your other files, mail, contacts or calendar.
        </li>
        <li>
          <span className="text-slate-300">Where your data goes:</span> straight from this browser to
          Google Drive. It never passes through a Copper server, and no one else receives it.
        </li>
        <li>
          The book is stored like your other Drive files — protected by your Google account, not
          separately encrypted.
        </li>
        <li>
          You can remove Copper's access any time in your{' '}
          <a
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 underline hover:text-slate-100"
          >
            Google Account
          </a>
          . What's on this device stays.
        </li>
      </ul>
    </details>
  );
}
