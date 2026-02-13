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
        textColor: 'hsl(240 5% 64.9%)',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'hsl(240 3.7% 12%)' },
        horzLines: { color: 'hsl(240 3.7% 12%)' },
      },
      rightPriceScale: {
        borderColor: 'hsl(240 3.7% 15.9%)',
      },
      timeScale: {
        borderColor: 'hsl(240 3.7% 15.9%)',
        timeVisible: true,
      },
      crosshair: {
        vertLine: { color: 'hsl(240 3.7% 25%)', labelBackgroundColor: '#333' },
        horzLine: { color: 'hsl(240 3.7% 25%)', labelBackgroundColor: '#333' },
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
