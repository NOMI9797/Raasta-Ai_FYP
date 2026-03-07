"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import toast from "react-hot-toast";
import { scrapingKeys, campaignKeys, leadKeys } from "./queryKeys";
import { scrapingApi, leadApi } from "./api";

/**
 * Custom hook for managing scraping operations using React Query
 * Handles scraping profiles, checking status, and updating leads with scraped data with caching
 */
export function useScraping() {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [scrapingProgress, setScrapingProgress] = useState({});

  // Check scraping status for a lead
  const checkScrapingStatus = useCallback(async (leadId) => {
    try {
      const leads = await scrapingApi.checkScrapingStatus(leadId);
      if (leads.length > 0) {
        const lead = leads[0];
        setScrapingProgress(prev => ({
          ...prev,
          [leadId]: {
            status: lead.status,
            progress: lead.status === 'processing' ? 50 : lead.status === 'completed' ? 100 : 0,
            message: lead.status === 'processing' ? 'Scraping profile data...' : 
                    lead.status === 'completed' ? 'Scraping completed!' : 
                    lead.status === 'error' ? lead.errorMessage : 'Starting...'
          }
        }));
        return lead;
      }
    } catch (error) {
      console.error("Error checking scraping status:", error);
    }
    return null;
  }, []);

  // Save posts mutation
  const savePostsMutation = useMutation({
    mutationFn: ({ leadId, posts }) => leadApi.savePosts({ leadId, posts }),
    onError: (error) => {
      console.warn('Error saving posts:', error);
    },
  });

  // Bulk update leads mutation (optimized)
  const bulkUpdateLeadsMutation = useMutation({
    mutationFn: ({ leadsData }) => leadApi.bulkUpdateLeads({ leadsData }),
    onError: (error) => {
      console.warn('Error bulk updating leads:', error);
    },
  });

  // Update lead mutation
  const updateLeadMutation = useMutation({
    mutationFn: ({ leadId, updateData }) => leadApi.updateLead({ leadId, updateData }),
    onSuccess: (_, { leadId, updateData, campaignId }) => {
      // Update lead in the campaign leads cache if campaignId is provided
      if (campaignId) {
        queryClient.setQueryData(campaignKeys.leads(campaignId), (oldLeads = []) =>
          oldLeads.map(lead => 
            (lead._id || lead.id) === leadId 
              ? { ...lead, ...updateData }
              : lead
          )
        );
      }
      // Invalidate posts cache for this lead
      queryClient.invalidateQueries({ queryKey: leadKeys.posts(leadId) });
    },
    onError: (error) => {
      console.warn('Error updating lead:', error);
    },
  });

  // Scraping mutation
  const scrapingMutation = useMutation({
    mutationFn: scrapingApi.scrapeProfiles,
    onError: (error) => {
      toast.error(`Scraping failed: ${error.message}`);
    },
  });

  // Process scraped data and update lead
  const processScrapedData = useCallback(async (leadId, items, leads, setLeads, leadUrl, campaignId = null) => {
    try {
      // Update progress: Processing data
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'processing',
          progress: 60,
          message: 'Processing scraped data...'
        }
      }));

      // Small delay to make progress visible
      await new Promise(resolve => setTimeout(resolve, 300));

      // Process scraped data exactly like Reachly
      const { extractLeadInfo, cleanScrapedPosts } = await import('@/libs/scraping-utils');
      const cleanedPosts = cleanScrapedPosts(items);
      const leadInfo = extractLeadInfo(cleanedPosts);
      
      console.log("Extracted lead info:", leadInfo);
      console.log("Cleaned posts count:", cleanedPosts.length);

      // Update progress: Saving posts
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'processing',
          progress: 75,
          message: 'Saving posts to database...'
        }
      }));

      // Save posts to database using mutation
      try {
        await savePostsMutation.mutateAsync({ leadId, posts: cleanedPosts });
      } catch (error) {
        console.warn('Failed to save posts, continuing...');
      }

      // Update progress: Updating lead
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'processing',
          progress: 90,
          message: 'Updating lead information...'
        }
      }));

      // Update lead in database using mutation
      const updateData = {
        name: leadInfo.name,
        title: leadInfo.title,
        company: leadInfo.company,
        location: leadInfo.location,
        profilePicture: leadInfo.profilePicture,
        status: 'completed'
      };

      try {
        await updateLeadMutation.mutateAsync({ leadId, updateData, campaignId });
      } catch (error) {
        console.warn('Failed to update lead, continuing...');
      }

      // Update progress: Completed
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'completed',
          progress: 100,
          message: `Found ${cleanedPosts.length} posts`
        }
      }));

      // Update leads state
      const completedLeads = leads.map((lead) =>
        (lead._id || lead.id) === leadId
          ? {
              ...lead,
              status: "completed",
              name: leadInfo.name,
              title: leadInfo.title,
              company: leadInfo.company,
              location: leadInfo.location,
              profilePicture: leadInfo.profilePicture,
              postsCount: cleanedPosts.length,
            }
          : lead
      );
      setLeads(completedLeads);
      
      return { leadInfo, cleanedPosts };
    } catch (error) {
      console.error(`Error processing scraped data for lead ${leadId}:`, error);
      
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'error',
          progress: 0,
          message: 'Failed to process scraped data'
        }
      }));

      throw error;
    }
  }, [savePostsMutation, updateLeadMutation]);

  // Scrape a single lead
  const scrapeLead = useCallback(async (lead, scrapingSettings, leads, setLeads, campaignId = null) => {
    const leadId = lead._id || lead.id;
    if (!leadId) {
      toast.error("Invalid lead ID");
      return false;
    }

    setIsProcessing(true);
    setScrapingProgress(prev => ({
      ...prev,
      [leadId]: {
        status: 'processing',
        progress: 0,
        message: 'Starting scraping...'
      }
    }));

    // Update lead to processing state
    const updatedLeads = leads.map((l) =>
      (l._id || l.id) === leadId ? { ...l, status: "processing" } : l
    );
    setLeads(updatedLeads);

    try {
      // Update progress: Scraping started
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'processing',
          progress: 10,
          message: 'Scraping LinkedIn profile...'
        }
      }));

      const result = await scrapingMutation.mutateAsync({
        urls: [lead.url],
        limitPerSource: scrapingSettings?.limitPerSource ?? 10,
        deepScrape: scrapingSettings?.deepScrape ?? true,
        rawData: scrapingSettings?.rawData ?? false,
        streamProgress: false
      });


      // Update progress: Data received
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'processing',
          progress: 50,
          message: `Received ${result.items?.length || 0} items, processing...`
        }
      }));

      // Small delay to make progress visible
      await new Promise(resolve => setTimeout(resolve, 500));

      if (result.items && result.items.length > 0) {
        const { leadInfo, cleanedPosts } = await processScrapedData(
          leadId, 
          result.items, 
          leads, 
          setLeads, 
          lead.url,
          campaignId
        );
        
        toast.success(`Successfully scraped ${cleanedPosts.length} posts from ${leadInfo.name}!`);
        return true;
      } else {
        throw new Error("No posts found for this profile");
      }
    } catch (error) {
      console.error("Scraping error:", error);
      
      setScrapingProgress(prev => ({
        ...prev,
        [leadId]: {
          status: 'error',
          progress: 0,
          message: error.message
        }
      }));

      // Update lead status to error in database
      try {
        await updateLeadMutation.mutateAsync({ 
          leadId, 
          updateData: { status: "error" }, 
          campaignId 
        });
      } catch (dbError) {
        console.warn('Failed to update lead status in database:', dbError);
      }

      const errorLeads = leads.map((l) =>
        (l._id || l.id) === leadId ? { ...l, status: "error" } : l
      );
      setLeads(errorLeads);
      
      toast.error(`Scraping failed: ${error.message}`);
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [processScrapedData, scrapingMutation]);

  // Scrape multiple leads
  const scrapeMultipleLeads = useCallback(async (pendingLeads, scrapingSettings, leads, setLeads, campaignId = null) => {
    if (pendingLeads.length === 0) {
      toast.error("No pending leads to scrape");
      return false;
    }

    setIsProcessing(true);
    
    // Set progress for all leads
    const progressUpdates = {};
    pendingLeads.forEach(lead => {
      const leadId = lead._id || lead.id;
      progressUpdates[leadId] = {
        status: 'processing',
        progress: 0,
        message: 'Starting scraping...'
      };
    });
    setScrapingProgress(prev => ({ ...prev, ...progressUpdates }));

    // Update all leads to processing
    const updatedLeads = leads.map((lead) => {
      const leadId = lead._id || lead.id;
      const isPending = pendingLeads.some(pending => (pending._id || pending.id) === leadId);
      return isPending ? { ...lead, status: "processing" } : lead;
    });
    setLeads(updatedLeads);

    try {
      // Extract URLs from pending leads
      const urls = pendingLeads.map(lead => lead.url);
      
      console.log("Sending URLs to scrape:", urls);
      console.log("Pending leads:", pendingLeads);
      
      const result = await scrapingMutation.mutateAsync({
        urls: urls,
        limitPerSource: scrapingSettings?.limitPerSource ?? 10,
        deepScrape: scrapingSettings?.deepScrape ?? true,
        rawData: scrapingSettings?.rawData ?? false,
        streamProgress: false
      });
      
      console.log("Scraping API response:", result);

      if (result.items && result.items.length > 0) {
        const { extractLeadInfo, cleanScrapedPosts } = await import('@/libs/scraping-utils');
        
        // Group items by source URL
        const itemsByUrl = {};
        result.items.forEach(item => {
          const sourceUrl = item.sourceUrl;
          if (!itemsByUrl[sourceUrl]) {
            itemsByUrl[sourceUrl] = [];
          }
          itemsByUrl[sourceUrl].push(item);
        });

        let successCount = 0;
        let errorCount = 0;
        const bulkUpdateData = [];

        // Process each lead and prepare bulk update data
        const finalLeads = await Promise.all(leads.map(async (lead) => {
          const leadId = lead._id || lead.id;
          const isPendingLead = pendingLeads.some(pending => (pending._id || pending.id) === leadId);
          
          if (!isPendingLead) {
            return lead; // Not being processed
          }

          const leadItems = itemsByUrl[lead.url] || [];
          
          if (leadItems.length > 0) {
            try {
              const { leadInfo, cleanedPosts } = await processScrapedData(
                leadId, 
                leadItems, 
                leads, 
                setLeads, 
                lead.url,
                campaignId
              );
              
              successCount++;
              
              // Prepare bulk update data
              bulkUpdateData.push({
                leadId,
                posts: cleanedPosts,
                status: "completed",
                name: leadInfo.name,
                title: leadInfo.title,
                company: leadInfo.company,
                location: leadInfo.location,
                profilePicture: leadInfo.profilePicture
              });
              
              return {
                ...lead,
                status: "completed",
                name: leadInfo.name,
                title: leadInfo.title,
                company: leadInfo.company,
                location: leadInfo.location,
                profilePicture: leadInfo.profilePicture,
                postsCount: cleanedPosts.length,
              };
            } catch (error) {
              console.error(`Error processing lead ${leadId}:`, error);
              
              setScrapingProgress(prev => ({
                ...prev,
                [leadId]: {
                  status: 'error',
                  progress: 0,
                  message: 'Failed to process scraped data'
                }
              }));
              
              // Prepare bulk update data for error
              bulkUpdateData.push({
                leadId,
                status: "error"
              });
              
              errorCount++;
              return { ...lead, status: "error" };
            }
          } else {
            // No data found for this lead
            setScrapingProgress(prev => ({
              ...prev,
              [leadId]: {
                status: 'error',
                progress: 0,
                message: 'No posts found for this profile'
              }
            }));
            
            // Prepare bulk update data for error
            bulkUpdateData.push({
              leadId,
              status: "error"
            });
            
            errorCount++;
            return { ...lead, status: "error" };
          }
        }));

        // Bulk update all leads and posts in database (optimized)
        if (bulkUpdateData.length > 0) {
          try {
            await bulkUpdateLeadsMutation.mutateAsync({ leadsData: bulkUpdateData });
            console.log(`Bulk updated ${bulkUpdateData.length} leads successfully`);
          } catch (bulkError) {
            console.warn('Bulk update failed, falling back to individual updates:', bulkError);
            // Fallback to individual updates if bulk fails
            for (const updateData of bulkUpdateData) {
              try {
                if (updateData.posts) {
                  await savePostsMutation.mutateAsync({ 
                    leadId: updateData.leadId, 
                    posts: updateData.posts 
                  });
                }
                await updateLeadMutation.mutateAsync({ 
                  leadId: updateData.leadId, 
                  updateData: { 
                    status: updateData.status,
                    name: updateData.name,
                    title: updateData.title,
                    company: updateData.company,
                    location: updateData.location,
                    profilePicture: updateData.profilePicture
                  }, 
                  campaignId 
                });
              } catch (fallbackError) {
                console.warn(`Failed to update lead ${updateData.leadId}:`, fallbackError);
              }
            }
          }
        }

        setLeads(finalLeads);

        if (successCount > 0) {
          toast.success(`Successfully scraped ${successCount} leads!`);
        }
        if (errorCount > 0) {
          toast.error(`${errorCount} leads failed to scrape`);
        }
        
        return { successCount, errorCount };
      } else {
        throw new Error("No posts found");
      }
    } catch (error) {
      console.error("Scraping error:", error);
      
      // Set all to error
      const errorUpdates = {};
      pendingLeads.forEach(lead => {
        const leadId = lead._id || lead.id;
        errorUpdates[leadId] = {
          status: 'error',
          progress: 0,
          message: error.message
        };
      });
      setScrapingProgress(prev => ({ ...prev, ...errorUpdates }));

      // Update all pending leads to error status in database (bulk operation)
      const errorBulkData = pendingLeads.map(lead => ({
        leadId: lead._id || lead.id,
        status: "error"
      }));

      try {
        await bulkUpdateLeadsMutation.mutateAsync({ leadsData: errorBulkData });
        console.log(`Bulk updated ${errorBulkData.length} leads to error status`);
      } catch (bulkError) {
        console.warn('Bulk error update failed, falling back to individual updates:', bulkError);
        // Fallback to individual updates
        for (const lead of pendingLeads) {
          const leadId = lead._id || lead.id;
          try {
            await updateLeadMutation.mutateAsync({ 
              leadId, 
              updateData: { status: "error" }, 
              campaignId 
            });
          } catch (dbError) {
            console.warn(`Failed to update lead ${leadId} status in database:`, dbError);
          }
        }
      }

      const errorLeads = leads.map((lead) => {
        const leadId = lead._id || lead.id;
        const isPending = pendingLeads.some(pending => (pending._id || pending.id) === leadId);
        return isPending ? { ...lead, status: "error" } : lead;
      });
      setLeads(errorLeads);
      
      toast.error(`Scraping failed: ${error.message}`);
      return { successCount: 0, errorCount: pendingLeads.length };
    } finally {
      setIsProcessing(false);
    }
  }, [processScrapedData, scrapingMutation]);

  // Clear scraping progress
  const clearScrapingProgress = useCallback(() => {
    setScrapingProgress({});
  }, []);

  return {
    isProcessing,
    scrapingProgress,
    setScrapingProgress,
    checkScrapingStatus,
    scrapeLead,
    scrapeMultipleLeads,
    clearScrapingProgress,
    // Additional React Query specific properties
    isScraping: scrapingMutation.isPending,
    isSavingPosts: savePostsMutation.isPending,
    isUpdatingLead: updateLeadMutation.isPending,
    isBulkUpdating: bulkUpdateLeadsMutation.isPending,
  };
}
