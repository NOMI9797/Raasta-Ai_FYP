/**
 * Summary Cards Component
 * 
 * Displays key metrics as visual cards with icons and percentages
 */

"use client";

import { Users, Send, CheckCircle, Clock, XCircle, TrendingUp } from "lucide-react";

export default function SummaryCards({ stats, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="card bg-base-100 shadow-md">
            <div className="card-body p-6">
              <div className="skeleton h-4 w-20 mb-2"></div>
              <div className="skeleton h-8 w-16"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  
  const cards = [
    {
      title: "Total Leads",
      value: stats.total,
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
      description: "All leads in campaigns"
    },
    {
      title: "Invites Sent",
      value: stats.totalInvitesSent,
      percentage: stats.total > 0 ? Math.round((stats.totalInvitesSent / stats.total) * 100) : 0,
      icon: Send,
      color: "text-info",
      bgColor: "bg-info/10",
      description: `${stats.total > 0 ? Math.round((stats.totalInvitesSent / stats.total) * 100) : 0}% of total`
    },
    {
      title: "Accepted",
      value: stats.accepted,
      percentage: stats.acceptanceRate,
      icon: CheckCircle,
      color: "text-success",
      bgColor: "bg-success/10",
      description: `${stats.acceptanceRate}% acceptance rate`,
      trend: stats.acceptanceRate >= 30 ? "up" : stats.acceptanceRate >= 15 ? "stable" : "down"
    },
    {
      title: "Pending",
      value: stats.sent + stats.pending,
      icon: Clock,
      color: "text-warning",
      bgColor: "bg-warning/10",
      description: "Awaiting response"
    },
    {
      title: "Rejected/Failed",
      value: stats.rejected + stats.failed,
      percentage: stats.totalInvitesSent > 0 ? Math.round(((stats.rejected + stats.failed) / stats.totalInvitesSent) * 100) : 0,
      icon: XCircle,
      color: "text-error",
      bgColor: "bg-error/10",
      description: `${stats.totalInvitesSent > 0 ? Math.round(((stats.rejected + stats.failed) / stats.totalInvitesSent) * 100) : 0}% of sent`
    }
  ];
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div key={index} className="card bg-base-200 shadow-md hover:shadow-xl transition-all">
            <div className="card-body p-6">
              <div className="flex items-start justify-between mb-2">
                <div className={`p-3 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-6 w-6 ${card.color}`} />
                </div>
                {card.trend && (
                  <div className={`badge badge-sm ${
                    card.trend === 'up' ? 'badge-success' : 
                    card.trend === 'down' ? 'badge-error' : 
                    'badge-ghost'
                  }`}>
                    <TrendingUp className={`h-3 w-3 ${card.trend === 'down' ? 'rotate-180' : ''}`} />
                  </div>
                )}
              </div>
              
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-base-content/60">
                  {card.title}
                </h3>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-base-content">
                    {card.value.toLocaleString()}
                  </p>
                  {card.percentage !== undefined && (
                    <span className={`badge ${
                      card.percentage >= 30 ? 'badge-success' :
                      card.percentage >= 15 ? 'badge-warning' :
                      'badge-ghost'
                    }`}>
                      {card.percentage}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-base-content/50">
                  {card.description}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

