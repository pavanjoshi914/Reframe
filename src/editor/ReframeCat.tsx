import React, { useEffect, useState, useRef } from 'react';
import { useEditor } from './store';
import { X } from 'lucide-react';

type Mood = 'curious' | 'happy' | 'shocked' | 'sleepy' | 'smug' | 'party';

interface CatThought {
  text: string;
  emoji?: string;
  mood: Mood;
}

const IDLE_THOUGHTS: CatThought[] = [
  { text: "Psst... that background is looking naked! Try Cyber Grid or Aura Bloom!", emoji: "✨", mood: "curious" },
  { text: "Hit Spacebar to play! Let's see those smooth 60fps moves!", emoji: "🎬", mood: "happy" },
  { text: "A blank background? In MY Reframe? Slap a gradient right meow!", emoji: "🎨", mood: "smug" },
  { text: "Did you know you can press Z to zoom in on your cursor? Magic!", emoji: "🔍", mood: "curious" },
  { text: "I'm the senior video producer here. Treat me with treats!", emoji: "🐟", mood: "smug" },
  { text: "Zzz... wake me up when you hit export...", emoji: "💤", mood: "sleepy" },
  { text: "Look at that cursor glide! My cat eyes can barely track it!", emoji: "👀", mood: "shocked" }
];

const PLAYING_THOUGHTS: CatThought[] = [
  { text: "WOOO! Look at it go! So smooth!", emoji: "🚀", mood: "party" },
  { text: "Vibing to the playback! Bobbing my head!", emoji: "🎶", mood: "happy" },
  { text: "That zoom easing is purr-fect!", emoji: "😻", mood: "happy" },
  { text: "Wait, did you see that click ripple?! Masterpiece!", emoji: "⚡", mood: "party" }
];

const POKE_RESPONSES: CatThought[] = [
  { text: "Meow! What's up, human?", emoji: "🐾", mood: "happy" },
  { text: "Hey! Who allowed you to poke the lead director?", emoji: "😾", mood: "smug" },
  { text: "Wheeeeee! *does a 360 flip*", emoji: "🌀", mood: "party" },
  { text: "Purrrrrrrrr... okay, that feels pretty nice.", emoji: "💖", mood: "happy" },
  { text: "Less poking, more editing! Add some scene text!", emoji: "🗂️", mood: "curious" },
  { text: "I have 9 lives, and all 9 are dedicated to good screen recordings.", emoji: "🐱", mood: "smug" }
];

export function ReframeCat() {
  const playing = useEditor((s) => s.playing);
  const bgMode = useEditor((s) => s.background.mode);
  const bgVal = useEditor((s) => s.background.value);

  const [pos, setPos] = useState({ x: 260, y: window.innerHeight - 280 });
  const [facingLeft, setFacingLeft] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [mood, setMood] = useState<Mood>('curious');
  const [thought, setThought] = useState<CatThought | null>({
    text: "Meow! Add a cool background & hit Play!",
    emoji: "👋",
    mood: "happy"
  });
  const [isSleeping, setIsSleeping] = useState(false);
  const [pokeCount, setPokeCount] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Autonomous wandering
  useEffect(() => {
    if (isSleeping || isMinimized) return;

    const interval = setInterval(() => {
      // 50% chance to roam
      if (Math.random() > 0.45 && !isDraggingRef.current) {
        setIsWalking(true);
        const minX = 60;
        const maxX = Math.max(300, window.innerWidth - 420);
        const targetX = Math.round(minX + Math.random() * (maxX - minX));
        
        setFacingLeft(targetX < pos.x);
        setPos((prev) => ({ ...prev, x: targetX }));

        setTimeout(() => {
          setIsWalking(false);
        }, 1800);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [isSleeping, isMinimized, pos.x]);

  // Context-aware thoughts
  useEffect(() => {
    if (isSleeping || isMinimized) return;

    if (playing) {
      const pick = PLAYING_THOUGHTS[Math.floor(Math.random() * PLAYING_THOUGHTS.length)];
      setThought(pick);
      setMood(pick.mood);
      return;
    }

    if (bgMode === 'color' && bgVal === '#000000') {
      setThought({
        text: "Black background? Nah, human! Try Cyber Grid or Mesh in the right sidebar!",
        emoji: "👾",
        mood: "shocked"
      });
      setMood("shocked");
      return;
    }

    const timer = setInterval(() => {
      if (Math.random() > 0.35) {
        const pick = IDLE_THOUGHTS[Math.floor(Math.random() * IDLE_THOUGHTS.length)];
        setThought(pick);
        setMood(pick.mood);
      }
    }, 9000);

    return () => clearInterval(timer);
  }, [playing, bgMode, bgVal, isSleeping, isMinimized]);

  // Handle Dragging
  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const newX = Math.max(20, Math.min(window.innerWidth - 120, e.clientX - dragOffsetRef.current.x));
    const newY = Math.max(40, Math.min(window.innerHeight - 120, e.clientY - dragOffsetRef.current.y));
    setPos({ x: newX, y: newY });
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handlePoke = () => {
    setPokeCount((c) => c + 1);
    setIsFlipping(true);
    setTimeout(() => setIsFlipping(false), 600);

    const pick = POKE_RESPONSES[pokeCount % POKE_RESPONSES.length];
    setThought(pick);
    setMood(pick.mood);
  };

  const [minimizedPos, setMinimizedPos] = useState({ x: 18, y: 54 });
  const isDraggingMinRef = useRef(false);
  const dragMinStartRef = useRef({ x: 0, y: 0, startPosX: 0, startPosY: 0, hasMoved: false });

  const handleMinPointerDown = (e: React.PointerEvent) => {
    isDraggingMinRef.current = true;
    dragMinStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPosX: minimizedPos.x,
      startPosY: minimizedPos.y,
      hasMoved: false
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handleMinPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingMinRef.current) return;
    const dx = e.clientX - dragMinStartRef.current.x;
    const dy = e.clientY - dragMinStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMinStartRef.current.hasMoved = true;
    }
    const newX = Math.max(10, Math.min(window.innerWidth - 120, dragMinStartRef.current.startPosX + dx));
    const newY = Math.max(48, Math.min(window.innerHeight - 60, dragMinStartRef.current.startPosY + dy));
    setMinimizedPos({ x: newX, y: newY });
  };

  const handleMinPointerUp = () => {
    isDraggingMinRef.current = false;
    if (!dragMinStartRef.current.hasMoved) {
      setIsMinimized(false);
    }
  };

  if (isMinimized) {
    return (
      <div
        style={{
          position: 'fixed',
          left: `${minimizedPos.x}px`,
          top: `${minimizedPos.y}px`,
          zIndex: 40
        }}
        onPointerDown={handleMinPointerDown}
        onPointerMove={handleMinPointerMove}
        onPointerUp={handleMinPointerUp}
        className="cursor-grab active:cursor-grabbing select-none"
        title="Click to wake Cat, or drag to reposition"
      >
        <div className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-[#0f1322]/90 px-2.5 py-1 text-xs text-indigo-200 shadow-xl backdrop-blur-md transition hover:scale-105 hover:border-indigo-400 hover:bg-indigo-950">
          <span className="text-sm">🐱</span>
          <span className="font-medium text-[11px] tracking-wide">Wake Cat</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        zIndex: 50,
        transition: isWalking ? 'left 1.8s cubic-bezier(0.25, 1, 0.5, 1)' : 'none'
      }}
      className="select-none pointer-events-auto"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Speech Bubble */}
      {thought && (
        <div
          onClick={() => setThought(null)}
          className={`absolute -top-16 left-1/2 -translate-x-1/2 min-w-[190px] max-w-[260px] cursor-pointer rounded-2xl border border-indigo-400/40 bg-[#0d101a]/95 p-2.5 text-xs text-indigo-100 shadow-2xl backdrop-blur-md transition-all duration-300 ${
            thought ? 'scale-100 opacity-100' : 'scale-90 opacity-0 pointer-events-none'
          }`}
          style={{ transformOrigin: 'bottom center' }}
          title="Click to dismiss thought"
        >
          <div className="flex items-start gap-1.5">
            {thought.emoji && <span className="text-base shrink-0">{thought.emoji}</span>}
            <p className="flex-1 text-[11px] leading-tight font-medium text-slate-200">
              {thought.text}
            </p>
          </div>
          {/* Speech bubble tail */}
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rotate-45 border-b border-r border-indigo-400/40 bg-[#0d101a]" />
        </div>
      )}

      {/* Cat Avatar Container */}
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative group"
      >
        {/* Single Sleek Close Button - appears on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsMinimized(true);
          }}
          className="absolute -top-1.5 -right-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/90 border border-white/20 text-slate-400 shadow-md opacity-0 group-hover:opacity-100 hover:!opacity-100 hover:bg-rose-600 hover:text-white transition duration-150 cursor-pointer"
          title="Close Cat"
        >
          <X size={11} strokeWidth={2.5} />
        </button>

        {/* Cat Avatar */}
        <div
          onClick={handlePoke}
          className={`cursor-grab active:cursor-grabbing transition-transform duration-300 ${
            facingLeft ? '-scale-x-100' : 'scale-x-100'
          } ${isFlipping ? 'animate-[spin_0.6s_ease-in-out]' : ''}`}
        >
          {/* Animated Cat SVG */}
          <svg
            width="84"
            height="76"
            viewBox="0 0 100 90"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`filter drop-shadow-[0_8px_18px_rgba(99,102,241,0.35)] transition-transform duration-150 ${
              isWalking ? 'animate-bounce' : 'hover:scale-105'
            }`}
          >
            {/* Tail */}
            <path
              d="M20 62 C10 60, 2 45, 8 32 C12 24, 18 28, 14 36 C10 44, 16 54, 26 56 Z"
              fill="#e2e8f0"
              className="origin-bottom-right transition-transform duration-700 animate-[pulse_2s_infinite]"
            />

            {/* Cat Body */}
            <ellipse cx="48" cy="58" rx="28" ry="22" fill="#f8fafc" />
            {/* Soft Calico Spots */}
            <path d="M42 42 Q52 38 60 48 Q55 58 40 54 Z" fill="#fb923c" opacity="0.85" />
            <path d="M28 50 Q36 45 38 62 Q26 66 26 54 Z" fill="#94a3b8" opacity="0.6" />

            {/* Legs / Paws */}
            <ellipse cx="32" cy="76" rx="7" ry="5" fill="#f1f5f9" className={isWalking ? 'animate-pulse' : ''} />
            <ellipse cx="46" cy="77" rx="6" ry="4" fill="#e2e8f0" />
            <ellipse cx="62" cy="76" rx="7" ry="5" fill="#f1f5f9" className={isWalking ? 'animate-pulse' : ''} />

            {/* Head */}
            <ellipse cx="68" cy="38" rx="22" ry="19" fill="#f8fafc" />
            {/* Calico face patch */}
            <path d="M60 22 Q75 18 84 28 Q80 42 66 32 Z" fill="#fb923c" opacity="0.85" />

            {/* Ears */}
            <polygon points="56,24 64,8 72,22" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
            <polygon points="59,22 64,12 69,21" fill="#f472b6" opacity="0.7" />
            <polygon points="74,22 84,10 88,26" fill="#fb923c" />
            <polygon points="77,21 83,14 85,24" fill="#f472b6" opacity="0.7" />

            {/* Eyes based on Mood */}
            {mood === 'sleepy' || isSleeping ? (
              <>
                {/* Closed curved happy eyes */}
                <path d="M62 38 Q66 43 70 38" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <path d="M76 38 Q80 43 84 38" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              </>
            ) : mood === 'party' ? (
              <>
                {/* Heart Eyes */}
                <text x="59" y="42" fontSize="12" fill="#ec4899">❤️</text>
                <text x="73" y="42" fontSize="12" fill="#ec4899">❤️</text>
              </>
            ) : mood === 'shocked' ? (
              <>
                {/* Big round wide eyes */}
                <ellipse cx="65" cy="36" rx="5.5" ry="6.5" fill="#0284c7" />
                <circle cx="65" cy="36" r="2.5" fill="#0f172a" />
                <circle cx="67" cy="34" r="1.5" fill="#ffffff" />

                <ellipse cx="80" cy="36" rx="5.5" ry="6.5" fill="#0284c7" />
                <circle cx="80" cy="36" r="2.5" fill="#0f172a" />
                <circle cx="82" cy="34" r="1.5" fill="#ffffff" />
              </>
            ) : (
              <>
                {/* Cute Shiny Anime Cat Eyes */}
                <ellipse cx="65" cy="36" rx="4.5" ry="5.5" fill="#10b981" />
                <ellipse cx="65" cy="36" rx="2" ry="4" fill="#064e3b" />
                <circle cx="66.5" cy="34.5" r="1.5" fill="#ffffff" />

                <ellipse cx="79" cy="36" rx="4.5" ry="5.5" fill="#10b981" />
                <ellipse cx="79" cy="36" rx="2" ry="4" fill="#064e3b" />
                <circle cx="80.5" cy="34.5" r="1.5" fill="#ffffff" />
              </>
            )}

            {/* Cute Nose */}
            <polygon points="72,43 75,43 73.5,45" fill="#f43f5e" />

            {/* Mouth */}
            <path d="M71 46 Q73.5 48 76 46" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M68.5 46 Q71 48 73.5 46" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" fill="none" />

            {/* Cute Whiskers */}
            <line x1="56" y1="41" x2="48" y2="39" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="56" y1="44" x2="47" y2="45" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="84" y1="41" x2="92" y2="39" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="84" y1="44" x2="93" y2="45" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />

            {/* Blush Cheeks */}
            <ellipse cx="61" cy="42" rx="3" ry="1.5" fill="#fda4af" opacity="0.75" />
            <ellipse cx="83" cy="42" rx="3" ry="1.5" fill="#fda4af" opacity="0.75" />
          </svg>
        </div>

        {/* Hover Mini Toolbar - with bridge padding so it never vanishes */}
        <div className={`absolute top-full left-1/2 -translate-x-1/2 pt-1 transition-opacity duration-200 ${
          isHovered ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/95 px-2.5 py-1 shadow-xl backdrop-blur-md">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePoke();
              }}
              title="Pet me!"
              className="hover:scale-125 transition text-xs"
            >
              🐾
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsSleeping(!isSleeping);
                setThought(isSleeping ? { text: "I'm awake and ready to supervise!", mood: "curious" } : { text: "Catnap mode activated... Zzz", mood: "sleepy" });
              }}
              title={isSleeping ? "Wake up" : "Take catnap"}
              className="hover:scale-125 transition text-xs"
            >
              {isSleeping ? '☀️' : '💤'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
