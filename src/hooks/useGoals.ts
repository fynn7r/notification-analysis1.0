import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/storage';

const DEFAULT_GOALS = ['提高综测'];

// 模块级单例状态
let goalsState: string[] = [];
let goalsLoaded = false;
let goalsLoading = true;
const goalsListeners = new Set<(items: string[], isLoading: boolean) => void>();

function notifyGoals() {
  goalsListeners.forEach((fn) => fn(goalsState, goalsLoading));
}

function initGoals() {
  if (goalsLoaded) return;
  goalsLoaded = true;

  const stored = storage.getGoals<string[] | null>(null);
  const initialized = storage.getGoalsInitialized();

  if (initialized) {
    goalsState = stored ?? [];
  } else {
    goalsState = DEFAULT_GOALS;
    storage.setGoals(DEFAULT_GOALS);
    storage.setGoalsInitialized(true);
  }
  goalsLoading = false;
  notifyGoals();
}

export function useGoals() {
  const [goals, setLocalGoals] = useState<string[]>(goalsState);
  const [loading, setLoading] = useState<boolean>(goalsLoading);

  useEffect(() => {
    initGoals();
    const listener = (newGoals: string[], newLoading: boolean) => {
      setLocalGoals(newGoals);
      setLoading(newLoading);
    };
    goalsListeners.add(listener);
    if (!goalsLoading) {
      setLocalGoals(goalsState);
      setLoading(false);
    }
    return () => {
      goalsListeners.delete(listener);
    };
  }, []);

  const addGoal = useCallback((goal: string) => {
    initGoals();
    const trimmed = goal.trim();
    if (!trimmed || goalsState.includes(trimmed)) return;
    goalsState = [...goalsState, trimmed];
    storage.setGoals(goalsState);
    notifyGoals();
  }, []);

  const removeGoal = useCallback((goal: string) => {
    initGoals();
    goalsState = goalsState.filter((g) => g !== goal);
    storage.setGoals(goalsState);
    notifyGoals();
  }, []);

  return { goals, loading, addGoal, removeGoal };
}
