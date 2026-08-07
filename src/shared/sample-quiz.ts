import type { Quiz } from "./quiz.js";

/**
 * The permanent sample quiz that ships with the site.
 *
 * P2 plays it as its local fixture; P3 seeds it, so a visitor can play
 * instantly and the demo survives a dry LLM key. Hand-written, hence
 * origin "manual" throughout.
 *
 * Correct answers are spread across all four positions on purpose — generated
 * quizzes get a Fisher-Yates shuffle in P1, but this one is written by hand.
 */
export const sampleQuiz: Quiz = {
  schemaVersion: 1,
  id: "sample",
  title: "The Solar System",
  createdAt: "2026-01-01T00:00:00.000Z",
  sourceMode: "manual",
  questions: [
    {
      id: "sample-1",
      stem: "Which planet orbits closest to the Sun?",
      options: ["Venus", "Mercury", "Mars", "Earth"],
      correctIndex: 1,
      origin: "manual",
    },
    {
      id: "sample-2",
      stem: "Which planet has the shortest day, spinning once in about ten hours?",
      options: ["Mars", "Neptune", "Venus", "Jupiter"],
      correctIndex: 3,
      origin: "manual",
    },
    {
      id: "sample-3",
      stem: "What is the Great Red Spot on Jupiter?",
      options: ["A crater", "A storm", "An ocean", "A volcano"],
      correctIndex: 1,
      origin: "manual",
    },
    {
      id: "sample-4",
      stem: "Which moon of Saturn has a thick atmosphere and lakes of liquid methane?",
      options: ["Europa", "Callisto", "Titan", "Phobos"],
      correctIndex: 2,
      origin: "manual",
    },
    {
      id: "sample-5",
      stem: "Roughly how long does sunlight take to reach the Earth?",
      options: ["8 minutes", "8 seconds", "8 hours", "80 minutes"],
      correctIndex: 0,
      origin: "manual",
    },
    {
      id: "sample-6",
      stem: "Which planet rotates on its side, with an axial tilt near 98 degrees?",
      options: ["Saturn", "Neptune", "Mercury", "Uranus"],
      correctIndex: 3,
      origin: "manual",
    },
    {
      id: "sample-7",
      stem: "Where in the Solar System is the main asteroid belt found?",
      options: [
        "Between Earth and Mars",
        "Between Mars and Jupiter",
        "Beyond Neptune",
        "Inside Mercury's orbit",
      ],
      correctIndex: 1,
      origin: "manual",
    },
    {
      id: "sample-8",
      stem: "Which planet has the hottest surface?",
      options: ["Mercury", "Mars", "Venus", "Jupiter"],
      correctIndex: 2,
      origin: "manual",
    },
    {
      id: "sample-9",
      stem: "What are the rings of Saturn mostly made of?",
      options: ["Hot gas", "Liquid metal", "Fine dust", "Ice and rock"],
      correctIndex: 3,
      origin: "manual",
    },
    {
      id: "sample-10",
      stem: "Which world did the Voyager 1 probe fly past on its way out of the Solar System?",
      options: ["Venus", "Jupiter", "Mercury", "Pluto"],
      correctIndex: 1,
      origin: "manual",
    },
  ],
};
