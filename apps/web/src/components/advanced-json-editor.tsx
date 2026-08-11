import { Check, Clipboard, Download, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadJson } from "../lib/download";
import { EditableWatch, parseImportedWatchDraft } from "../lib/watch-draft";
import { Button, ErrorText, InlineNotice } from "./ui";

export function AdvancedJsonEditor({
  draft,
  watchName,
  onImport,
}: {
  draft: EditableWatch;
  watchName: string;
  onImport(draft: EditableWatch): void;
}) {
  const [content, setContent] = useState(() => JSON.stringify(draft, null, 2));
  const [error, setError] = useState<Error>();
  const [copied, setCopied] = useState(false);
  useEffect(() => setContent(JSON.stringify(draft, null, 2)), [draft]);

  const importJson = () => {
    try {
      const parsed = JSON.parse(content) as unknown;
      onImport(parseImportedWatchDraft(parsed, draft));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Invalid JSON."));
    }
  };

  return (
    <div className="json-editor">
      <InlineNotice tone="info" title="Safe export">
        This is the API-compatible watch document. Runtime lease fields and
        webhook secrets are never included.
      </InlineNotice>
      <div className="code-toolbar">
        <span>watch.json</span>
        <div>
          <Button
            variant="ghost"
            size="small"
            onClick={async () => {
              await navigator.clipboard.writeText(content);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={() => downloadJson(`${slug(watchName)}.watch.json`, draft)}
          >
            <Download size={15} />
            Download
          </Button>
        </div>
      </div>
      <label className="sr-only" htmlFor="watch-json">
        Watch JSON
      </label>
      <textarea
        id="watch-json"
        className="code-editor"
        spellCheck={false}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <ErrorText error={error} />
      <div className="json-editor__footer">
        <p>
          Import replaces all editable fields in the current browser draft.
          Nothing is saved until you review and apply.
        </p>
        <Button variant="secondary" onClick={importJson}>
          <Upload size={16} />
          Import into draft
        </Button>
      </div>
    </div>
  );
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "watch"
  );
}
