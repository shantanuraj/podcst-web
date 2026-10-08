import type React from 'react';
import { create } from 'zustand';

export interface ToastAction {
  label: string;
  run: () => void;
}

type ToastState = {
  message: React.ReactNode | null;
  action: ToastAction | null;
  showToast: (message: React.ReactNode, action?: ToastAction) => void;
  clearToast: () => void;
};

export const toastTimeout = 3000;
export const actionToastTimeout = 6000;

export const useToast = create<ToastState>((set) => ({
  message: null,
  action: null,
  showToast: (message, action) => set({ message, action: action ?? null }),
  clearToast: () => set({ message: null, action: null }),
}));

export const getMessage = (state: ToastState) => state.message;
export const getAction = (state: ToastState) => state.action;
export const getShowToast = (state: ToastState) => state.showToast;
export const getClearToast = (state: ToastState) => state.clearToast;
