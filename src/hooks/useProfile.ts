import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/storage';

export interface IUserProfile {
  nickname: string;
  school: string;
  major: string;
  grade: string;
  defaultRemindOffset: string;
  soundEnabled: boolean;
  browserNotifEnabled: boolean;
  voiceReminderEnabled: boolean;
}

const DEFAULT_PROFILE: IUserProfile = {
  nickname: '',
  school: '',
  major: '',
  grade: '',
  defaultRemindOffset: '1d',
  soundEnabled: true,
  browserNotifEnabled: false,
  voiceReminderEnabled: true,
};

// 模块级单例
let profileState: IUserProfile = { ...DEFAULT_PROFILE };
let profileLoaded = false;
let profileLoading = true;
const profileListeners = new Set<(p: IUserProfile, isLoading: boolean) => void>();

function notifyProfile() {
  profileListeners.forEach((fn) => fn(profileState, profileLoading));
}

function initProfile() {
  if (profileLoaded) return;
  profileLoaded = true;

  const stored = storage.getProfile<IUserProfile | null>(null);
  if (stored) {
    profileState = { ...DEFAULT_PROFILE, ...stored };
  }
  profileLoading = false;
  notifyProfile();
}

export function useProfile() {
  const [profile, setLocalProfile] = useState<IUserProfile>(profileState);
  const [loading, setLoading] = useState<boolean>(profileLoading);

  useEffect(() => {
    initProfile();
    const listener = (p: IUserProfile, isLoading: boolean) => {
      setLocalProfile(p);
      setLoading(isLoading);
    };
    profileListeners.add(listener);
    if (!profileLoading) {
      setLocalProfile(profileState);
      setLoading(false);
    }
    return () => {
      profileListeners.delete(listener);
    };
  }, []);

  const updateProfile = useCallback((updates: Partial<IUserProfile>) => {
    initProfile();
    profileState = { ...profileState, ...updates };
    storage.setProfile(profileState);
    notifyProfile();
  }, []);

  const setProfile = useCallback((p: IUserProfile) => {
    initProfile();
    profileState = p;
    storage.setProfile(profileState);
    notifyProfile();
  }, []);

  return { profile, loading, updateProfile, setProfile };
}
