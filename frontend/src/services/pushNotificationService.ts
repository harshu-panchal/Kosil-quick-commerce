import { messaging, getToken, onMessage } from '../firebase';
import axios from 'axios';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "dummy-vapid-key";
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

// Register service worker
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Unregister existing workers to ensure fresh update if needed
            // const registrations = await navigator.serviceWorker.getRegistrations();
            // for(let registration of registrations) {
            //     registration.unregister();
            // }

            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
                scope: '/'
            });
            console.log('✅ Service Worker registered:', registration);
            return registration;
        } catch (error) {
            console.error('❌ Service Worker registration failed:', error);
            // Don't throw to avoid crashing app on non-supported envs
            return null;
        }
    } else {
        console.warn('Service Workers are not supported');
        return null;
    }
}

// Request notification permission
export async function requestNotificationPermission() {
    if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('✅ Notification permission granted');
            return true;
        } else {
            console.log('❌ Notification permission denied');
            return false;
        }
    }
    return false;
}

// Get FCM token
export async function getFCMToken() {
    if (!messaging) return null;

    try {
        const registration = await registerServiceWorker();
        if (!registration) return null; // Failed or not supported

        // Wait for service worker to be ready
        // verifying that the registration is active
        await navigator.serviceWorker.ready;

        console.log('DEBUG: Using VAPID Key:', VAPID_KEY);

        try {
            const token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: registration
            });

            if (token) {
                console.log('✅ FCM Token obtained:', token);
                return token;
            } else {
                console.log('❌ No FCM token available');
                return null;
            }
        } catch (tokenError: any) {
            console.error('❌ Error calling getToken:', tokenError);
            if (tokenError.code === 'messaging/token-subscribe-failed' || tokenError.message?.includes('Missing required authentication credential')) {
                console.error(`👉 POTENTIAL FIX: Check your Google Cloud Console API Key restrictions. ` +
                    `Ensure "${window.location.origin}" (and with trailing slash) is allowed in HTTP Referrers.`);
            }
            throw tokenError;
        }

    } catch (error) {
        console.error('❌ Error getting FCM token (outer):', error);
        return null;
    }
}

// Register FCM token with backend
export async function registerFCMToken(forceUpdate = false) {
    if (!messaging) return null;

    try {
        // Check if already registered
        const savedToken = localStorage.getItem('fcm_token_web');
        if (savedToken && !forceUpdate) {
            console.log('FCM token already registered locally');
            return savedToken;
        }

        // Request permission first
        const hasPermission = await requestNotificationPermission();
        if (!hasPermission) {
            console.warn('Notification permission not granted, skipping token registration');
            return null;
        }

        // Get token
        const token = await getFCMToken();
        if (!token) {
            console.warn('Failed to get FCM token, skipping backend registration');
            return null;
        }

        // Save to backend
        const authToken = localStorage.getItem('authToken'); // Fixed: Changed 'token' to 'authToken'
        if (!authToken) {
            console.warn('No auth token found, cannot register FCM token with backend');
            return token; // Return token anyway, maybe retry later
        }

        try {
            const response = await axios.post(`${API_URL}/fcm-tokens/save`, {
                token: token,
                platform: 'web'
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (response.data.success) {
                localStorage.setItem('fcm_token_web', token);
                console.log('✅ FCM token registered with backend');
                return token;
            }
        } catch (apiError) {
            console.error('Failed to register token with backend API:', apiError);
            // We obtained the token but failed to save it. We should probably not save it to local storage 
            // essentially treating it as "not registered" so we retry next time.
        }

        return token;
    } catch (error) {
        console.error('❌ Error in registerFCMToken flow:', error);
        return null;
    }
}

// Setup foreground notification handler
export function setupForegroundNotificationHandler(handler?: (payload: any) => void) {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
        console.log('📬 Foreground message received:', payload);

        // Default behavior: Show a standard notification even in foreground if user wants
        // Or you can use a custom toast/snackbar in the UI
        if ('Notification' in window && Notification.permission === 'granted') {
            const { title, body, icon } = payload.notification || {};
            new Notification(title || 'New Notification', {
                body: body,
                icon: icon || '/favicon.ico',
                data: payload.data
            });
        }

        // Call custom handler if provided (e.g. to update UI badge or show toast)
        if (handler) {
            handler(payload);
        }
    });
}

// Initialize push notifications
export async function initializePushNotifications() {
    try {
        // Just register service worker on init to be ready
        await registerServiceWorker();
    } catch (error) {
        console.error('Error initializing push notifications:', error);
    }
}
