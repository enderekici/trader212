'use client';

import { useEffect, useRef } from 'react';
import { ColorType, createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';

interface DataPoint {
  time: string;
  value: number;
}

interface StockChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  type?: 'area' | 'line';
}

export function StockChart({
  data,
  height = 300,
  color = '#10b981',
  type = 'area',
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9fa0a6',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1c1c22' },
        horzLines: { color: '#1c1c22' },
      },
      rightPriceScale: {
        borderColor: '#26262c',
      },
      timeScale: {
        borderColor: '#26262c',
        timeVisible: true,
      },
      crosshair: {
        vertLine: { color: '#3c3c44', labelBackgroundColor: '#333' },
        horzLine: { color: '#3c3c44', labelBackgroundColor: '#333' },
      },
    });

    chartRef.current = chart;

    if (type === 'area') {
      const series = chart.addAreaSeries({
        lineColor: color,
        topColor: `${color}40`,
        bottomColor: `${color}05`,
        lineWidth: 2,
      });
      seriesRef.current = series;
    } else {
      const series = chart.addLineSeries({
        color,
        lineWidth: 2,
      });
      seriesRef.current = series;
    }

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [height, color, type]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      seriesRef.current.setData(
        data.map((d) => ({ time: d.time as string, value: d.value })) as Parameters<
          typeof seriesRef.current.setData
        >[0],
      );
    }
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}
