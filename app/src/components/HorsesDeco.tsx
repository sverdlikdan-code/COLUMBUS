import React from 'react';
import { View } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';

// Galloping horse silhouette — white outline, no fill
const HORSE_PATH =
  'M 62,11 C 65,7 72,5 76,8 C 80,11 79,17 75,20 L 77,18 ' +
  'C 81,22 83,30 79,38 L 83,52 L 79,53 L 75,40 ' +
  'C 70,46 60,47 53,43 L 49,56 L 45,56 L 47,42 ' +
  'C 39,37 34,29 32,22 L 26,18 ' +
  'C 21,13 17,7 21,3 C 25,0 32,2 34,7 ' +
  'L 40,5 C 46,1 56,4 62,11 Z ' +
  'M 72,10 C 74,7 78,7 79,10'; // ear detail

interface Props {
  width?: number;
  height?: number;
}

export default function HorsesDeco({ width = 90, height = 70 }: Props) {
  return (
    <View style={{ width, height, position: 'relative' }}>
      {/* Back horse — smallest, most faded */}
      <View style={{ position: 'absolute', top: 2, left: 0, opacity: 0.12 }}>
        <Svg width={60} height={46} viewBox="0 0 100 70">
          <G transform="scale(1,1)">
            <Path d={HORSE_PATH} stroke="white" strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </G>
        </Svg>
      </View>

      {/* Middle horse */}
      <View style={{ position: 'absolute', top: 8, left: 8, opacity: 0.22 }}>
        <Svg width={72} height={56} viewBox="0 0 100 70">
          <Path d={HORSE_PATH} stroke="white" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      </View>

      {/* Front horse — largest, most visible */}
      <View style={{ position: 'absolute', top: 0, left: 14, opacity: 0.38 }}>
        <Svg width={82} height={64} viewBox="0 0 100 70">
          <Path d={HORSE_PATH} stroke="white" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      </View>
    </View>
  );
}
