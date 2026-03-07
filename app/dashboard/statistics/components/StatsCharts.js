/**
 * Statistics Charts Component
 * 
 * Funnel Chart and Metric Cards for invite statistics
 */

"use client";

import { TrendingUp, TrendingDown, Users, Send, CheckCircle, XCircle, Clock, Target } from "lucide-react";

export default function StatsCharts({ stats, byCampaign, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card bg-base-200 shadow-lg">
          <div className="card-body">
            <div className="skeleton h-6 w-32 mb-4"></div>
            <div className="skeleton h-64 w-full"></div>
          </div>
        </div>
        <div className="card bg-base-200 shadow-lg">
          <div className="card-body">
            <div className="skeleton h-6 w-32 mb-4"></div>
            <div className="skeleton h-64 w-full"></div>
          </div>
        </div>
      </div>
    );
  }
  
  // Calculate conversion rates for funnel
  const totalLeads = stats.total || 1;
  const invitesSent = stats.totalInvitesSent || 0;
  const accepted = stats.accepted || 0;
  const rejected = stats.rejected || 0;
  const failed = stats.failed || 0;
  const pending = stats.sent || 0;
  
  const funnelSteps = [
    {
      label: "Total Leads",
      value: totalLeads,
      percentage: 100,
      bgColor: "bg-primary",
      textColor: "text-primary",
      icon: Users,
      conversionRate: null
    },
    {
      label: "Invites Sent",
      value: invitesSent,
      percentage: totalLeads > 0 ? Math.round((invitesSent / totalLeads) * 100) : 0,
      bgColor: "bg-info",
      textColor: "text-info",
      icon: Send,
      conversionRate: totalLeads > 0 ? Math.round((invitesSent / totalLeads) * 100) : 0
    },
    {
      label: "Accepted",
      value: accepted,
      percentage: invitesSent > 0 ? Math.round((accepted / invitesSent) * 100) : 0,
      bgColor: "bg-success",
      textColor: "text-success",
      icon: CheckCircle,
      conversionRate: invitesSent > 0 ? Math.round((accepted / invitesSent) * 100) : 0
    },
    {
      label: "Pending",
      value: pending,
      percentage: invitesSent > 0 ? Math.round((pending / invitesSent) * 100) : 0,
      bgColor: "bg-warning",
      textColor: "text-warning",
      icon: Clock,
      conversionRate: invitesSent > 0 ? Math.round((pending / invitesSent) * 100) : 0
    },
    {
      label: "Rejected/Failed",
      value: rejected + failed,
      percentage: invitesSent > 0 ? Math.round(((rejected + failed) / invitesSent) * 100) : 0,
      bgColor: "bg-error",
      textColor: "text-error",
      icon: XCircle,
      conversionRate: invitesSent > 0 ? Math.round(((rejected + failed) / invitesSent) * 100) : 0
    }
  ].filter(step => step.value > 0 || step.label === "Total Leads");
  
  const maxValue = Math.max(...funnelSteps.map(s => s.value), 1);
  
  // Additional metric cards
  const additionalMetrics = [
    {
      title: "Conversion Rate",
      value: `${stats.acceptanceRate}%`,
      description: "Invites to Accepted",
      icon: Target,
      color: "text-success",
      bgColor: "bg-success/10",
      trend: stats.acceptanceRate >= 30 ? "up" : stats.acceptanceRate >= 15 ? "stable" : "down"
    },
    {
      title: "Invite Rate",
      value: `${totalLeads > 0 ? Math.round((invitesSent / totalLeads) * 100) : 0}%`,
      description: "Leads to Invites",
      icon: Send,
      color: "text-info",
      bgColor: "bg-info/10",
      trend: (invitesSent / totalLeads) >= 0.5 ? "up" : "stable"
    },
    {
      title: "Success Rate",
      value: `${totalLeads > 0 ? Math.round((accepted / totalLeads) * 100) : 0}%`,
      description: "Leads to Accepted",
      icon: CheckCircle,
      color: "text-primary",
      bgColor: "bg-primary/10",
      trend: (accepted / totalLeads) >= 0.3 ? "up" : "stable"
    }
  ];
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Funnel Chart */}
      <div className="lg:col-span-2 card bg-base-200 shadow-lg">
        <div className="card-body">
          <h3 className="card-title text-lg mb-4">Invite Conversion Funnel</h3>
          
          {stats.total === 0 ? (
            <div className="flex items-center justify-center h-64 text-base-content/40">
              <p>No data available</p>
            </div>
          ) : (
            <div className="py-4 space-y-3">
              {funnelSteps.map((step, index) => {
                const Icon = step.icon;
                const widthPercentage = (step.value / maxValue) * 100;
                const isFirst = index === 0;
                const isLast = index === funnelSteps.length - 1;
                
                return (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${step.bgColor} bg-opacity-20`}>
                          <Icon className={`h-4 w-4 ${step.textColor}`} />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-base-content">{step.label}</p>
                          {step.conversionRate !== null && !isFirst && (
                            <p className="text-xs text-base-content/60">
                              {step.conversionRate}% conversion
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-base-content">{step.value.toLocaleString()}</p>
                        <p className="text-xs text-base-content/60">{step.percentage}%</p>
                      </div>
                    </div>
                    
                    {/* Funnel bar */}
                    <div className="relative">
                      <div 
                        className={`h-10 rounded-lg ${step.bgColor} transition-all duration-500 flex items-center justify-between px-4`}
                        style={{ 
                          width: `${widthPercentage}%`,
                          minWidth: '120px'
                        }}
                      >
                        <span className="text-xs font-semibold text-white">
                          {step.value.toLocaleString()}
                        </span>
                        {!isLast && (
                          <div className="flex items-center gap-1 text-white/80">
                            <span className="text-xs">
                              {step.conversionRate !== null ? `${step.conversionRate}%` : ''}
                            </span>
                            {step.conversionRate !== null && step.conversionRate > 0 && (
                              <TrendingDown className="h-3 w-3" />
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Conversion arrow indicator */}
                      {!isLast && (
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                          <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-base-200"></div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      {/* Metric Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-base-content mb-2">Key Metrics</h3>
        {additionalMetrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div key={index} className="card bg-base-200 shadow-lg hover:shadow-xl transition-all">
              <div className="card-body p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                    <Icon className={`h-5 w-5 ${metric.color}`} />
                  </div>
                  {metric.trend && (
                    <div className={`badge badge-sm ${
                      metric.trend === 'up' ? 'badge-success' : 
                      metric.trend === 'down' ? 'badge-error' : 
                      'badge-ghost'
                    }`}>
                      {metric.trend === 'up' ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : metric.trend === 'down' ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : null}
                    </div>
                  )}
                </div>
                
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-base-content/60">
                    {metric.title}
                  </h4>
                  <p className="text-2xl font-bold text-base-content">
                    {metric.value}
                  </p>
                  <p className="text-xs text-base-content/50">
                    {metric.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
