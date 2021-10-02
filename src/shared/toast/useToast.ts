import React from 'react';
import create from 'zustand';

type ToastState = {
  message: React.ReactNode | null;
  showToast: (message: React.ReactNode) => void;
  clearToast: () => void;
};

export const toastTimeout = 3000;

export const useToast = create<ToastState>((set) => ({
  message: null,
  showToast: (message) => set({ message }),
  clearToast: () => set({ message: null }),
}));

export const getMessage = (state: ToastState) => state.message;
export const getShowToast = (state: ToastState) => state.showToast;
export const getClearToast = (state: ToastState) => state.clearToast;