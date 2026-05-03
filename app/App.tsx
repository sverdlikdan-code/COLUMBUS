import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import SetupScreen from './src/screens/SetupScreen';
import RouteScreen from './src/screens/RouteScreen';

interface Session {
  agentCode: string;
  agentName: string;
  managerName: string;
  startCity: string;
  selectedDay: number;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  return (
    <>
      <StatusBar style="light" />

      {session ? (
        <RouteScreen
          agentCode={session.agentCode}
          agentName={session.agentName}
          managerName={session.managerName}
          startCity={session.startCity}
          selectedDay={session.selectedDay}
          onBack={() => setSession(null)}
        />
      ) : (
        <SetupScreen
          onStart={(agentCode, agentName, managerName, city, day) =>
            setSession({ agentCode, agentName, managerName, startCity: city, selectedDay: day })
          }
        />
      )}
    </>
  );
}
