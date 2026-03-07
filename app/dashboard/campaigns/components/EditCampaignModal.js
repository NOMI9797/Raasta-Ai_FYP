"use client";

import { useState, useEffect } from "react";
import { X, Save, Loader2 } from "lucide-react";

export default function EditCampaignModal({ open, onClose, onSubmit, campaign }) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    targetRole: "",
    industry: "",
    serviceType: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Initialize form data when campaign changes
  useEffect(() => {
    if (campaign) {
      const icp = campaign.icpConfig || {};
      setFormData({
        name: campaign.name || "",
        description: campaign.description || "",
        targetRole: icp.targetRole || "",
        industry: icp.industry || "",
        serviceType: icp.serviceType || "",
      });
    }
  }, [campaign]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    const newErrors = {};
    if (!formData.name.trim()) {
      newErrors.name = "Campaign name is required";
    }
    if (formData.name.length > 100) {
      newErrors.name = "Campaign name must be less than 100 characters";
    }
    if (formData.description && formData.description.length > 500) {
      newErrors.description = "Description must be less than 500 characters";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const updateData = {
        name: formData.name,
        description: formData.description,
        icpConfig: (formData.targetRole || formData.industry || formData.serviceType)
          ? { targetRole: formData.targetRole?.trim() || "", industry: formData.industry?.trim() || "", serviceType: formData.serviceType?.trim() || "" }
          : null,
      };
      await onSubmit(campaign.id, updateData);
      setErrors({});
    } catch (error) {
      console.error("Error updating campaign:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ""
      }));
    }
  };

  if (!open) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box w-11/12 max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-base-content">Edit Campaign</h3>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
            disabled={loading}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Campaign Name */}
          <div className="form-control">
            <label className="label" htmlFor="name">
              <span className="label-text font-medium">Campaign Name</span>
              <span className="label-text-alt text-error">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Enter campaign name..."
              className={`input input-bordered w-full ${
                errors.name ? "input-error" : ""
              }`}
              value={formData.name}
              onChange={handleInputChange}
              disabled={loading}
              maxLength={100}
            />
            {errors.name && (
              <label className="label">
                <span className="label-text-alt text-error">{errors.name}</span>
              </label>
            )}
            <label className="label">
              <span className="label-text-alt text-base-content/60">
                {formData.name.length}/100 characters
              </span>
            </label>
          </div>

          {/* Description */}
          <div className="form-control">
            <label className="label" htmlFor="description">
              <span className="label-text font-medium">Description</span>
              <span className="label-text-alt text-base-content/60">Optional</span>
            </label>
            <textarea
              id="description"
              name="description"
              placeholder="Describe your campaign goals..."
              className={`textarea textarea-bordered w-full ${
                errors.description ? "textarea-error" : ""
              }`}
              value={formData.description}
              onChange={handleInputChange}
              disabled={loading}
              maxLength={500}
              rows={3}
            />
            {errors.description && (
              <label className="label">
                <span className="label-text-alt text-error">{errors.description}</span>
              </label>
            )}
            <label className="label">
              <span className="label-text-alt text-base-content/60">
                {formData.description.length}/500 characters
              </span>
            </label>
          </div>

          {/* ICP (Ideal Customer Profile) - optional */}
          <div className="divider text-sm text-base-content/60">Ideal Customer Profile (optional)</div>
          <div className="form-control">
            <label className="label" htmlFor="edit-targetRole">
              <span className="label-text font-medium">Target Role</span>
            </label>
            <input
              id="edit-targetRole"
              name="targetRole"
              type="text"
              placeholder="e.g. CTO, Head of Engineering"
              className="input input-bordered w-full"
              value={formData.targetRole}
              onChange={handleInputChange}
              disabled={loading}
            />
          </div>
          <div className="form-control">
            <label className="label" htmlFor="edit-industry">
              <span className="label-text font-medium">Industry</span>
            </label>
            <input
              id="edit-industry"
              name="industry"
              type="text"
              placeholder="e.g. SaaS, Fintech"
              className="input input-bordered w-full"
              value={formData.industry}
              onChange={handleInputChange}
              disabled={loading}
            />
          </div>
          <div className="form-control">
            <label className="label" htmlFor="edit-serviceType">
              <span className="label-text font-medium">Service Type</span>
            </label>
            <input
              id="edit-serviceType"
              name="serviceType"
              type="text"
              placeholder="e.g. B2B Software, Consulting"
              className="input input-bordered w-full"
              value={formData.serviceType}
              onChange={handleInputChange}
              disabled={loading}
            />
          </div>

          {/* Actions */}
          <div className="modal-action">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary gap-2"
              disabled={loading || !formData.name.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Update Campaign
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
}
