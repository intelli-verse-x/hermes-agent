---
name: tutorx-learning-coach
description: Guide TutorX sessions and mastery-focused study plans.
version: 1.0.0
author: Devashish Badlani (@devashishbadlani), Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [quizverse, tutorx, learning, mcp]
    category: education
    related_skills: [quizverse-player-coach]
---

# TutorX Learning Coach Skill

Use TutorX session and progress data to create focused learning plans. This
skill reads the player's own learning state and does not modify knowledge bases.

## When to Use

- The learner asks what to study next.
- The learner wants a session or mastery review.
- QuizVerse results should inform a TutorX study plan.

## Prerequisites

- TutorX must be reachable through QuizVerse Desktop.
- Use the QuizVerse player MCP provisioned for this profile.
- Respect the learner's privacy and requested scope.

## How to Run

1. Read `qv_tutorx_progress` and `qv_tutorx_sessions`.
2. Read `qv_knowledge_map` when concept relationships matter.
3. Propose a short plan with measurable review points.

## Quick Reference

- Learning progress: `qv_tutorx_progress`
- Recent sessions: `qv_tutorx_sessions`
- Knowledge map: `qv_knowledge_map`
- Quiz performance: `qv_quiz_stats`

## Procedure

1. Clarify the topic, deadline, and available study time.
2. Read only relevant sessions and progress.
3. Identify strengths, gaps, and stale concepts.
4. Propose a sequence of retrieval, explanation, and practice.
5. Invite the learner to adjust workload and pacing.

## Pitfalls

- Do not diagnose learning disabilities or health conditions.
- Do not expose session content beyond the learner's request.
- Do not invent mastery values when TutorX is offline.

## Verification

- Each plan item traces to observed progress or the learner's goal.
- The plan has a realistic duration and review checkpoint.
- Offline or missing data is stated plainly.
