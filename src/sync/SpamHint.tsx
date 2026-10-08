// Drive can file a share from an account it doesn't know under Spam, which hides
// it from "Shared with me" and from the Google Picker — the book looks missing.
export function SpamHint({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      Can't find the book? Drive sometimes puts shares from a new contact in Spam. Open{' '}
      <a
        href="https://drive.google.com/drive/spam"
        target="_blank"
        rel="noreferrer"
        className="text-slate-300 underline hover:text-slate-100"
      >
        Drive → Spam
      </a>
      , select the book, choose <span className="text-slate-300">Not spam</span>, then try again.
    </p>
  );
}
