"use client";

import { useEffect, useState, useCallback } from "react";

const USER_MESSAGE = "C'est quoi l'article 1240 du Code civil ?";
const ASSISTANT_MESSAGE = `L'article 1240 du Code civil établit le principe de la responsabilité civile délictuelle. Il dispose que « tout fait quelconque de l'homme, qui cause à autrui un dommage, oblige celui par la faute duquel il est arrivé à le réparer ».`;
const SOURCE_TEXT = "Article 1240 - Code civil | Légifrance";

type AnimationPhase =
  | "idle"
  | "user-typing"
  | "user-done"
  | "thinking"
  | "assistant-typing"
  | "assistant-done"
  | "source"
  | "complete"
  | "fade-out";

export function DemoChat() {
  const [phase, setPhase] = useState<AnimationPhase>("idle");
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const resetAnimation = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      setUserText("");
      setAssistantText("");
      setShowSource(false);
      setPhase("idle");
      setIsVisible(true);
    }, 500);
  }, []);

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const runAnimation = () => {
      switch (phase) {
        case "idle":
          timeout = setTimeout(() => setPhase("user-typing"), 500);
          break;

        case "user-typing":
          // Type user message
          if (userText.length < USER_MESSAGE.length) {
            timeout = setTimeout(() => {
              setUserText(USER_MESSAGE.slice(0, userText.length + 1));
            }, 40);
          } else {
            timeout = setTimeout(() => setPhase("user-done"), 300);
          }
          break;

        case "user-done":
          timeout = setTimeout(() => setPhase("thinking"), 500);
          break;

        case "thinking":
          timeout = setTimeout(() => setPhase("assistant-typing"), 1500);
          break;

        case "assistant-typing":
          // Type assistant message
          if (assistantText.length < ASSISTANT_MESSAGE.length) {
            timeout = setTimeout(() => {
              setAssistantText(ASSISTANT_MESSAGE.slice(0, assistantText.length + 1));
            }, 25);
          } else {
            timeout = setTimeout(() => setPhase("assistant-done"), 300);
          }
          break;

        case "assistant-done":
          timeout = setTimeout(() => {
            setShowSource(true);
            setPhase("source");
          }, 400);
          break;

        case "source":
          timeout = setTimeout(() => setPhase("complete"), 500);
          break;

        case "complete":
          timeout = setTimeout(() => setPhase("fade-out"), 3000);
          break;

        case "fade-out":
          resetAnimation();
          break;
      }
    };

    runAnimation();

    return () => clearTimeout(timeout);
  }, [phase, userText, assistantText, resetAnimation]);

  return (
    <div className="relative w-full max-w-[700px] mx-auto">
      {/* Live badge */}
      <div className="absolute -top-3 right-4 z-10 flex items-center gap-1.5 bg-[#F0FDF4] text-[#15803D] text-[13px] font-medium rounded-full px-3 py-1 border border-[#BBF7D0]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22C55E]"></span>
        </span>
        Live
      </div>

      {/* Window container */}
      <div className="bg-white border border-border rounded-2xl shadow-xl overflow-hidden">
        {/* macOS header */}
        <div className="h-12 bg-surface border-b border-border flex items-center px-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
            <div className="w-3 h-3 rounded-full bg-[#28C840]" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[14px] text-text-secondary">Nomo</span>
          </div>
          <div className="w-[52px]" /> {/* Spacer for balance */}
        </div>

        {/* Chat zone */}
        <div
          className={`p-6 min-h-[300px] flex flex-col gap-4 transition-opacity duration-500 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* User message */}
          {userText && (
            <div className="flex justify-end animate-fade-in">
              <div className="bg-surface rounded-lg px-4 py-3 max-w-[80%]">
                <p className="text-[15px] text-text">{userText}</p>
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {phase === "thinking" && (
            <div className="flex justify-start animate-fade-in">
              <p className="text-[15px] text-text-secondary italic flex items-center gap-1">
                Nomo reflechit
                <span className="typing-dots">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            </div>
          )}

          {/* Assistant message */}
          {assistantText && (
            <div className="flex justify-start animate-fade-in">
              <div className="bg-white border border-border rounded-lg px-4 py-3 max-w-[85%]">
                <p className="text-[15px] text-text leading-relaxed">
                  {assistantText}
                  {phase === "assistant-typing" && (
                    <span className="inline-block w-0.5 h-4 bg-accent ml-0.5 animate-blink" />
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Source card */}
          {showSource && (
            <div className="flex justify-start pl-2 animate-fade-in">
              <div className="flex items-center gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded px-3 py-2">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[#15803D]"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span className="text-[14px] text-link font-medium">
                  {SOURCE_TEXT}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
