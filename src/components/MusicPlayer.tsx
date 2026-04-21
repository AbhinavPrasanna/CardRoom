import { useCallback, useEffect, useId, useRef, useState } from "react";

const VOLUME_KEY = "poker-music-volume";
const OPEN_KEY = "poker-music-panel-open";

type Track = { id: string; name: string; url: string };

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return 0.65;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.65;
  } catch {
    return 0.65;
  }
}

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeAfterSrcChange = useRef(false);
  const playingRef = useRef(false);
  const indexRef = useRef(0);
  const playlistRef = useRef<Track[]>([]);

  const [open, setOpen] = useState(readStoredOpen);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(readStoredVolume);
  const [loopPlaylist, setLoopPlaylist] = useState(true);
  const loopPlaylistRef = useRef(true);

  const panelId = useId();
  const volumeInputId = `${panelId}-volume`;
  playingRef.current = playing;
  indexRef.current = index;
  playlistRef.current = playlist;
  loopPlaylistRef.current = loopPlaylist;

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* ignore */
    }
  }, [volume]);

  const revokeAll = useCallback((tracks: Track[]) => {
    for (const t of tracks) {
      try {
        URL.revokeObjectURL(t.url);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const safeIndex = playlist.length ? Math.min(index, playlist.length - 1) : 0;

  useEffect(() => {
    if (safeIndex !== index && playlist.length) setIndex(safeIndex);
  }, [safeIndex, index, playlist.length]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!playlist.length) {
      el.pause();
      el.removeAttribute("src");
      delete el.dataset.npTrack;
      el.load();
      setPlaying(false);
      return;
    }
    const track = playlist[safeIndex];
    if (!track) return;
    el.volume = volume;
    if (el.dataset.npTrack === track.id) {
      return;
    }
    el.dataset.npTrack = track.id;
    el.pause();
    el.src = track.url;
    el.load();
    const go = async () => {
      if (!resumeAfterSrcChange.current) return;
      resumeAfterSrcChange.current = false;
      try {
        await el.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    };
    void go();
  }, [playlist, safeIndex, volume]);

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el || !playlist.length) return;
    if (el.paused) {
      try {
        await el.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const onAudioEnded = () => {
    const pl = playlistRef.current;
    if (!pl.length) {
      setPlaying(false);
      return;
    }
    const s = Math.min(indexRef.current, pl.length - 1);
    if (s < pl.length - 1) {
      resumeAfterSrcChange.current = true;
      setIndex(s + 1);
    } else if (loopPlaylistRef.current) {
      resumeAfterSrcChange.current = true;
      setIndex(0);
    } else {
      setPlaying(false);
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: Track[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (!f) continue;
      if (!f.type.startsWith("audio/")) continue;
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `t-${Date.now()}-${i}`;
      next.push({ id, name: f.name.replace(/\.[^/.]+$/, "") || f.name, url: URL.createObjectURL(f) });
    }
    if (!next.length) return;
    setPlaylist((prev) => {
      if (prev.length === 0) {
        setIndex(0);
        return next;
      }
      return [...prev, ...next];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeTrack = (id: string) => {
    setPlaylist((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i < 0) return prev;
      const cur = Math.min(indexRef.current, prev.length - 1);
      const removingCurrent = i === cur;
      if (playingRef.current && removingCurrent && prev.length > 1) {
        resumeAfterSrcChange.current = true;
      }
      const t = prev[i];
      try {
        URL.revokeObjectURL(t.url);
      } catch {
        /* ignore */
      }
      const rest = prev.filter((x) => x.id !== id);
      setIndex((idx) => {
        if (rest.length === 0) return 0;
        if (i < idx) return idx - 1;
        if (i === idx) return Math.min(idx, rest.length - 1);
        return idx;
      });
      if (rest.length === 0) setPlaying(false);
      return rest;
    });
  };

  const clearPlaylist = () => {
    setPlaylist((prev) => {
      revokeAll(prev);
      setIndex(0);
      setPlaying(false);
      return [];
    });
  };

  const current = playlist[safeIndex];

  return (
    <div className="music-player-dock" aria-label="Background music">
      <audio
        ref={audioRef}
        onEnded={onAudioEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        preload="metadata"
      />
      <button
        type="button"
        className="music-player-fab"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Close" : "Music"}
      </button>
      {open ? (
        <div id={panelId} className="music-player-panel" role="region" aria-label="Music controls">
          <p className="music-player-hint">
            Add your own audio files (MP3, OGG, etc.). Playback stays on while you move between the lobby and a
            table.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="music-player-file-input"
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="music-player-actions">
            <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
              Add tracks
            </button>
            <button type="button" className="btn btn-ghost" disabled={!playlist.length} onClick={clearPlaylist}>
              Clear all
            </button>
          </div>
          {playlist.length ? (
            <ul className="music-player-list">
              {playlist.map((t, i) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`music-player-track${i === safeIndex ? " music-player-track--current" : ""}`}
                    onClick={() => {
                      resumeAfterSrcChange.current = playing;
                      setIndex(i);
                    }}
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    className="music-player-remove"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => removeTrack(t.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="music-player-empty">No tracks yet — add files to build a playlist.</p>
          )}
          <div className="music-player-transport">
            <button type="button" className="btn btn-primary" disabled={!playlist.length} onClick={togglePlay}>
              {playing ? "Pause" : "Play"}
            </button>
            <label className="music-player-loop">
              <input
                type="checkbox"
                checked={loopPlaylist}
                onChange={(e) => setLoopPlaylist(e.target.checked)}
              />
              Loop playlist
            </label>
          </div>
          <div className="music-player-volume">
            <label htmlFor={volumeInputId}>Volume</label>
            <input
              id={volumeInputId}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
          {current ? (
            <p className="music-player-now mono" aria-live="polite">
              Now: {current.name}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
