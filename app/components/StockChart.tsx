'use client';

import { useEffect, useRef } from 'react';

interface StockChartProps {
  data: {
    date: string;
    price: number;
  }[];
  height?: number;
  isPositive?: boolean;
}

export default function StockChart({ data, height = 200, isPositive = true }: StockChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Determine min and max price for scaling
    const prices = data.map(entry => entry.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;

    // Padding
    const paddingX = 30;
    const paddingY = 20;
    const chartWidth = canvas.width - paddingX * 2;
    const chartHeight = canvas.height - paddingY * 2;

    // Draw axes
    ctx.beginPath();
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    
    // Scale points
    const points = data.map((entry, index) => {
      const x = paddingX + (index / (data.length - 1)) * chartWidth;
      const y = paddingY + chartHeight - ((entry.price - minPrice) / priceRange) * chartHeight;
      return { x, y };
    });

    // Draw the line
    ctx.beginPath();
    ctx.strokeStyle = isPositive ? '#10B981' : '#EF4444';
    ctx.lineWidth = 2;
    
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    
    ctx.stroke();

    // Fill area under the line
    ctx.lineTo(points[points.length - 1].x, paddingY + chartHeight);
    ctx.lineTo(points[0].x, paddingY + chartHeight);
    ctx.closePath();
    ctx.fillStyle = isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    ctx.fill();

    // Draw price labels
    ctx.font = '12px Arial';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'right';
    ctx.fillText(`$${minPrice.toFixed(2)}`, paddingX - 5, paddingY + chartHeight);
    ctx.fillText(`$${maxPrice.toFixed(2)}`, paddingX - 5, paddingY);

    // Draw date labels
    ctx.textAlign = 'center';
    ctx.fillText(data[0].date, points[0].x, paddingY + chartHeight + 15);
    ctx.fillText(data[data.length - 1].date, points[points.length - 1].x, paddingY + chartHeight + 15);
    
  }, [data, height, isPositive]);

  return (
    <canvas 
      ref={canvasRef} 
      width={800} 
      height={height} 
      className="w-full h-auto"
    />
  );
} 