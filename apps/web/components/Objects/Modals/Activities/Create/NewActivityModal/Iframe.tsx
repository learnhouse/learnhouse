import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  FormMessage,
  Input,
} from '@components/StyledElements/Form/Form';
import React, { useState } from 'react';
import * as Form from '@radix-ui/react-form';
import BarLoader from 'react-spinners/BarLoader';
import { Code } from 'lucide-react';

interface IframeObject {
  name: string;
  type: string;
  uri: string; // Stores only the URL
  chapter_id: string;
}

function Iframe({ submitIframeActivity, chapterId, course }: any) {
  const [name, setName] = React.useState('');
  const [iframeCode, setIframeCode] = React.useState(''); // Full iframe code entered by user
  const [iframeUrl, setIframeUrl] = React.useState(''); // Extracted URL
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };

  const handleIframeCodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const code = event.target.value;
    setIframeCode(code);
    // Extract the URL from the iframe code
    const urlMatch = code.match(/src=['"]([^'"]+)['"]/);
    const url = urlMatch ? urlMatch[1] : '';
    setIframeUrl(url);
  };

  // const handleSubmit = async (e: any) => {
  //   e.preventDefault();
  //   setIsSubmitting(true);

  //   let iframeObject: IframeObject = {
  //     name,
  //     type: 'iframe',
  //     uri: iframeUrl, // Store only the extracted URL
  //     chapter_id: chapterId,
  //   };

  //   let status = await submitIframeActivity(iframeObject, 'activity', chapterId);
  //   setIsSubmitting(false);
  // };
  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsSubmitting(true);
  
    let iframeObject: IframeObject = {
      name,
      type: 'iframe',
      uri: iframeUrl, // Store only the extracted URL
      chapter_id: chapterId,
    };
  
    await submitIframeActivity(iframeObject, 'activity', chapterId); // Call the updated function
    setIsSubmitting(false);
  };
  

  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="iframe-activity-name">
        <Flex css={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <FormLabel>Activity Name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a name for your iframe activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleNameChange} type="text" required />
        </Form.Control>
      </FormField>

      <div className="justify-center m-auto align-middle">
        <FormField name="iframe-code">
          <Flex css={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <FormLabel className="flex items-center">
              <span>Iframe Code  </span>
              <Code className="ml-1" />
            </FormLabel>
            <FormMessage match="valueMissing">
              Please provide the iframe code for your activity
            </FormMessage>
          </Flex>
          <Form.Control asChild>
            <Input
              className="bg-white"
              onChange={handleIframeCodeChange}
              type="text"
              placeholder="<iframe src='your-iframe-link' />"
              required
              style={{ width: '100%' }} // Ensure full-width input
            />
          </Form.Control>
        </FormField>
      </div>

      {/* Display the extracted URL */}
      {iframeUrl && (
        <div className="iframe-preview mt-4 p-4 bg-gray-100 rounded-lg shadow-lg">
          <h3 className="text-center text-lg font-semibold mb-2">Preview:</h3>
          <div
            className="iframe-container"
            style={{
              border: '2px solid #ccc',
              padding: '10px',
              borderRadius: '10px',
              backgroundColor: '#f9f9f9',
              maxWidth: '100%',
              overflow: 'hidden',
              boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)',
            }}
          >
            <iframe
              src={iframeUrl}
              style={{
                border: 'none',
                width: '100%',
                height: '500px',
                backgroundColor: 'white',
              }}
              title="Iframe Preview"
            />
          </div>
        </div>
      )}

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack className="bg-black" type="submit" css={{ marginTop: 10 }}>
            {isSubmitting ? (
              <BarLoader cssOverride={{ borderRadius: 60 }} width={60} color="#ffffff" />
            ) : (
              'Create Activity'
            )}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  );
}

export default Iframe;
