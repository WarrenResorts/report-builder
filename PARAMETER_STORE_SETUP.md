# Parameter Store Setup Guide

## Required Parameters for Email Processing

Based on your infrastructure configuration, you need to populate these Parameter Store values in AWS:

### Environment: Development
**Parameter Path Prefix:** `/report-builder/development/`

#### 1. Email Recipients (who receives the consolidated reports)
```
Parameter Name: /report-builder/development/email/recipients
Type: String
Value: email1@example.com,email2@example.com,email3@example.com
Description: Comma-separated list of emails to receive daily consolidated reports
```

#### 2. Alert Notification Email
```
Parameter Name: /report-builder/development/email/alert-notifications  
Type: String
Value: alerts@warrenresorthotels.com
Description: Email address for system alerts and error notifications
```

#### 3. From Email Address
```
Parameter Name: /report-builder/development/email/from-address
Type: String
Value: reports@aws.warrenresorthotels.com
Description: Sender email address for outgoing reports
```

#### 4. SES Configuration Set
```
Parameter Name: /report-builder/development/ses/configuration-set
Type: String
Value: report-builder-development
Description: SES configuration set name for the current environment
```

#### 5. Property Email Mapping (Critical for processing)
```
Parameter Name: /report-builder/development/properties/email-mapping
Type: String
Value: {
  "property1@hotel-management-system.com": "best-western-windsor",
  "property2@hotel-management-system.com": "driftwood-inn", 
  "property3@hotel-management-system.com": "lakeside-lodge",
  "property4@hotel-management-system.com": "marina-beach-motel",
  "property5@hotel-management-system.com": "property-4",
  "property6@hotel-management-system.com": "property-5",
  "property7@hotel-management-system.com": "property-6",
  "property8@hotel-management-system.com": "property-7",
  "property9@hotel-management-system.com": "property-8",
  "property10@hotel-management-system.com": "property-9",
  "property11@hotel-management-system.com": "property-10",
  "property12@hotel-management-system.com": "property-14",
  "property13@hotel-management-system.com": "property-unknown-1",
  "property14@hotel-management-system.com": "property-unknown-2"
}
Description: JSON mapping of sender email addresses to property IDs
```

## How to Set Parameters

### Option 1: AWS Console
1. Go to [AWS Systems Manager Console](https://console.aws.amazon.com/systems-manager/)
2. Navigate to **Parameter Store** in the left sidebar
3. Click **Create parameter**
4. Enter the parameter name exactly as shown above
5. Select **String** as the type
6. Enter the value
7. Click **Create parameter**

### Option 2: AWS CLI (if shell issues are resolved)
```bash
# Example for recipients
aws ssm put-parameter \
  --name "/report-builder/development/email/recipients" \
  --value "user1@example.com,user2@example.com" \
  --type "String" \
  --region us-east-1

# Example for property mapping
aws ssm put-parameter \
  --name "/report-builder/development/properties/email-mapping" \
  --value '{"sender@example.com":"property-id"}' \
  --type "String" \
  --region us-east-1
```

## Important Notes

1. **Property Mapping**: You'll need to replace the example sender emails with the actual email addresses from your 14 property management systems
2. **Property IDs**: Use consistent property identifiers that match your mapping file structure
3. **Recipients**: Replace with the actual email addresses that should receive the consolidated reports
4. **Environment**: If deploying to production, create the same parameters with `/report-builder/production/` prefix

## Production Environment
For production deployment, create identical parameters with the prefix:
`/report-builder/production/` 