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
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    
    // Handle edge case: all prices are the same or only one data point
    if (minPrice === maxPrice) {
      minPrice = minPrice - 10; // Add some padding
      maxPrice = maxPrice + 10;
    }
    // Ensure minPrice is not below 0 unless necessary
    if (minPrice < 0 && Math.min(...prices) >=0) {
        minPrice = 0;
    }
    if (maxPrice === 0 && minPrice === 0 && prices.every(p => p === 0)) { // if all prices are 0
        maxPrice = 1; // Avoid division by zero if all prices are 0, show flat line at 0
    }

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
      const x = paddingX + (data.length > 1 ? (index / (data.length - 1)) * chartWidth : chartWidth / 2); // Center if single point
      // Handle priceRange === 0 to avoid division by zero; place point in middle or at bottom/top
      const y = paddingY + (priceRange === 0 ? chartHeight / 2 : chartHeight - ((entry.price - minPrice) / priceRange) * chartHeight);
      return { x, y };
    });

    // Draw the line or a single point
    ctx.beginPath();
    ctx.strokeStyle = isPositive ? '#10B981' : '#EF4444';
    ctx.lineWidth = 2;

    if (data.length > 1) {
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
    } else if (data.length === 1) {
      // Draw a single point as a circle
      ctx.fillStyle = isPositive ? '#10B981' : '#EF4444';
      ctx.arc(points[0].x, points[0].y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    
    // Draw price labels
    ctx.font = '12px Arial';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'right';
    
    // Adjust Y labels if priceRange was 0 initially to reflect padded min/max
    const displayMinPrice = (priceRange === 0 && prices.length > 0) ? prices[0] -10 : minPrice;
    const displayMaxPrice = (priceRange === 0 && prices.length > 0) ? prices[0] +10 : maxPrice;
    if (prices.every(p => p === 0) && priceRange === 0) { // Special case for all zero prices
        ctx.fillText(`$0.00`, paddingX - 5, paddingY + chartHeight / 2);
    } else {
        ctx.fillText(`$${(priceRange === 0 ? prices[0] : minPrice).toFixed(2)}`, paddingX - 5, paddingY + chartHeight);
        ctx.fillText(`$${(priceRange === 0 ? prices[0] : maxPrice).toFixed(2)}`, paddingX - 5, paddingY);
    }


    // Draw date labels
    ctx.textAlign = 'center';
    if (data.length > 0 && points.length > 0) {
        ctx.fillText(data[0].date, points[0].x, paddingY + chartHeight + 15);
        if (data.length > 1 && points.length > 1) {
            ctx.fillText(data[data.length - 1].date, points[points.length - 1].x, paddingY + chartHeight + 15);
        }
    }
    
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